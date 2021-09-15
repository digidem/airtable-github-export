var Airtable = require('airtable')
var parallel = require('run-parallel')
var Hubfs = require('hubfs.js')
var geojsonhint = require('@mapbox/geojsonhint')
var isEqualWith = require('lodash/isEqualWith')
var rewind = require('@mapbox/geojson-rewind')
var debug = require('debug')('airtable-github-export')
var stringify = require('json-stable-stringify')

require('dotenv').config()

var config = {
  tables: process.env.TABLES.split(','),
  githubToken: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO,
  owner: process.env.GITHUB_OWNER,
  airtableToken: process.env.AIRTABLE_API_KEY,
  base: process.env.AIRTABLE_BASE_ID,
  branches: process.env.GITHUB_BRANCH ? process.env.GITHUB_BRANCH.split(',') : ['master'],
  filename: process.env.GITHUB_FILENAME || 'data.json'
}

var CREATE_MESSAGE = '[AIRTABLE-GITHUB-EXPORT] create ' + config.filename
var UPDATE_MESSAGE = '[AIRTABLE-GITHUB-EXPORT] update ' + config.filename

var hubfsOptions = {
  owner: config.owner,
  repo: config.repo,
  auth: {
    token: config.githubToken
  }
}

var gh = Hubfs(hubfsOptions)

var base = new Airtable({apiKey: config.airtableToken}).base(config.base)

var output = {}

var tasks = config.tables.map(function (tableName) {
  return function (cb) {
    var data = []
    // Ensure properties of output are set in the same order
    // otherwise they are set async and may change order, which
    // results in unhelpful diffs in Github
    output[tableName] = null

    base(tableName).select().eachPage(page, done)

    function page (records, next) {
      // This function will get called for each page of records.
      records.forEach(function (record) {
        var feature = {
          type: 'Feature',
          id: record._rawJson.id,
          properties: record._rawJson.fields || {}
        }
        var geometry = parseGeometry(get(record, 'geometry'))
        var coords = parseCoords([get(record, 'lon'), get(record, 'lat')])
        if (geometry) {
          feature.geometry = geometry
          delete feature.properties.geometry
          delete feature.properties.Geometry
        } else if (coords) {
          feature.geometry = {
            type: 'Point',
            coordinates: coords
          }
        } else {
          feature.geometry = null
        }
        data.push(feature)
      })
      next()
    }

    function done (err) {
      if (err) return cb(err)
      var featureCollection = {
        type: 'FeatureCollection',
        features: data
      }
      output[tableName] = featureCollection
      cb()
    }
  }
})

parallel(tasks, function (err, result) {
  if (err) return onError(err)
  gh.readFile(config.filename, {ref: config.branches[0]}, function (err, data) {
    if (err) {
      if (!(/not found/i.test(err) || err.notFound)) {
        return onError(err)
      }
    } else {
      data = JSON.parse(data)
    }
    if (data && isEqualWith(data, output, customComparison)) {
      return debug('No changes from Airtable, skipping update to Github')
    }
    var message = data ? UPDATE_MESSAGE : CREATE_MESSAGE
    ghWrite(config.filename, output, config.branches, message, function (err) {
      if (err) return onError(err)
      debug('Updated ' + config.owner + '/' + config.repo + '/' + config.filename +
        ' with latest changes from Airtable')
    })
  })
})

function ghWrite (filename, data, branches, message, cb) {
  var pending = branches.length
  branches.forEach(function (branch) {
    var opts = {
      message: message,
      branch: branch
    }
    gh.writeFile(filename, stringify(data, { replacer: null, space: 2 }), opts, done)
  })
  function done (err) {
    if (err) return cb(err)
    if (--pending > 0) return
    cb()
  }
}

function onError (err) {
  console.error(err)
  process.exit(1)
}

// Case insensitive record.get
function get (record, fieldName) {
  if (typeof record.get(fieldName) !== 'undefined') {
    return record.get(fieldName)
  } else if (typeof record.get(fieldName.charAt(0).toUpperCase() + fieldName.slice(1)) !== 'undefined') {
    return record.get(fieldName.charAt(0).toUpperCase() + fieldName.slice(1))
  } else if (typeof record.get(fieldName.toUpperCase()) !== 'undefined') {
    return record.get(fieldName.toUpperCase())
  }
}

// Try to parse a geometry field if it is valid GeoJSON geometry
function parseGeometry (geom) {
  if (!geom) return null
  try {
    geom = rewind(JSON.parse(geom))
  } catch (e) {
    return null
  }
  var errors = geojsonhint.hint(geom)
  if (errors && errors.length) return null
  return geom
}

// Check whether coordinates are valid
function parseCoords (coords) {
  if (typeof coords[0] !== 'number' || typeof coords[1] !== 'number') return null
  if (coords[0] < -180 || coords[0] > 180 || coords[1] < -90 || coords[1] > 90) return null
  return coords
}

function isUrl(value) {
  if (typeof value !== 'string') return false
  try {
    new URL(value)
    return true
  } catch (e) {
    return false
  }
}

/** For URLs, ignore the query string when comparing, because Airtable adds a
 * timestamp to the URLs returned from the API which changes every time */
function customComparison (objValue, othValue) {
  // if neither is a URL, return undefined to use default comparison
  if ((!isUrl(objValue) && isUrl(othValue))) return
  const objUrl = new URL(objValue)
  const othUrl = new URL(othValue)
  objUrl.search = ''
  othUrl.search = ''
  return objUrl.toString() === othUrl.toString()
}

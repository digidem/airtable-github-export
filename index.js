var Airtable = require('airtable')
var parallel = require('run-parallel')
var Hubfs = require('hubfs.js')
var geojsonhint = require('@mapbox/geojsonhint')
var deepEqual = require('deep-equal')
var rewind = require('geojson-rewind')

require('dotenv').config()

var config = {
  tables: process.env.TABLES.split(','),
  githubToken: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO,
  owner: process.env.GITHUB_OWNER,
  airtableToken: process.env.AIRTABLE_API_KEY,
  base: process.env.AIRTABLE_BASE_ID,
  branch: process.env.GITHUB_BRANCH || 'master',
  filename: process.env.GITHUB_FILENAME || 'data.json'
}

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
  gh.readFile(config.filename, {ref: config.branch}, function (err, data) {
    if (err) {
      if (/not found/i.test(err) || err.notFound) {
        data = {}
      } else {
        return onError(err)
      }
    } else {
      data = JSON.parse(data)
    }
    if (deepEqual(data, output)) {
      return console.log('No changes from Airtable, skipping update to Github')
    }

    gh.writeFile(config.filename, JSON.stringify(output, null, 2), {branch: config.branch}, function (err) {
      if (err) return onError(err)
      console.log('Updated ' + config.owner + '/' + config.repo + '/' + config.filename + ' with latest changes from Airtable')
    })
  })
})

function onError (err) {
  console.error(err)
  process.exit(1)
}

// Case insensitive record.get
function get (record, fieldName) {
  return record.get(fieldName) ||
    record.get(fieldName.charAt(0).toUpperCase() + fieldName.slice(1)) ||
    record.get(fieldName.toUpperCase())
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

function parseCoords (coords) {
  if (typeof coords[0] !== 'number' || typeof coords[1] !== 'number') return null
  if (coords[0] < -180 || coords[0] > 180 || coords[1] < -90 || coords[1] > 90) return null
  return coords
}

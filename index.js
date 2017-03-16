var Airtable = require('airtable')
var parallel = require('run-parallel')
var Hubfs = require('hubfs.js')
var geojsonhint = require('@mapbox/geojsonhint')

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

    base(tableName).select().eachPage(page, done)

    function page (records, next) {
      // This function will get called for each page of records.
      records.forEach(function (record) {
        var feature = {
          type: 'Feature',
          id: record._rawJson.id,
          properties: record._rawJson.fields || {}
        }
        var geometry = record.get('geometry') || record.get('Geometry')
        if (isValidGeometry(geometry)) {
          feature.geometry = geometry
        } else if (record.get('Lon') && record.get('Lat')) {
          feature.geometry = {
            type: 'Point',
            coordinates: [record.get('Lon'), record.get('Lat')]
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
  if (err) return console.error(err)
  gh.writeFile(config.filename, JSON.stringify(output, null, 2), {branch: config.branch}, function (err) {
    if (err) return console.error(err)
  })
})

function isValidGeometry (geom) {
  try {
    geom = JSON.parse(geom)
  } catch (e) {
    return false
  }
  var errors = geojsonhint.hint(geom)
  if (errors && errors.length) return false
  return true
}

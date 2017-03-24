# airtable-github-export

> Export airtable tables to json/geojson in Github

We created this so that we could manage data for an online map in [Airtable](https://airtable.com/). It will export one or more tables in Airtable to an object of [GeoJSON](http://geojson.org/) files on Github. It parses each table for either a text field named `geometry`, which should be a stringified valid [GeoJSON geometry](https://tools.ietf.org/html/rfc7946#section-3.1), or two number fields named `lon` and `lat` which should be valid longitude and latitude in WGS84. The exported file will be of the format:

```
{
  <table_name>: {...} // GeoJSON FeatureCollection
}
```

## Usage

The script depends on several environment variables which you can set a `.env` file if you run this locally:

```
TABLES=Table 1, Table 2
GITHUB_TOKEN=xxxxxx
GITHUB_REPO=github_repo_name
GITHUB_OWNER=github_repo_owner_name
AIRTABLE_API_KEY=airtable_api_key
AIRTABLE_BASE_ID=airtable_base_id
GITHUB_BRANCH=github_branch_for_export
GITHUB_FILENAME=filename_for_github_export
```

Run the export with `node airtable-export.js`

## Contribute

PRs accepted.

## License

MIT © Digital Democracy

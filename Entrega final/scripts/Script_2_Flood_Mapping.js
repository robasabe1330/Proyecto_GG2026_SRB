// ============================================================
// SCRIPT 2 — ANNUAL FLOOD MAPPING — RÍO BITA
// Loads seasonal composites from Assets and applies SWIR threshold
// Method: Wolski et al. (2017) / Inman & Lyons (2020)
// ============================================================


// ============================================================
// USER ASSET PATH
// Replace with your own Earth Engine asset path
// ============================================================

var ASSET_PATH = 'projects/user/assets/';


// ============================================================
// AOI AND REFERENCE GEOMETRIES
// ============================================================

var Bita_FC      = ee.FeatureCollection(ASSET_PATH + 'Vita_ZH');
var Rio_Bita_AOI = Bita_FC.geometry();

var Zona_Humeda_Ref = ee.FeatureCollection(
  ASSET_PATH + 'Bita_Zona_Humeda_Ref'
).geometry();

var Zona_Seca_Ref = ee.FeatureCollection(
  ASSET_PATH + 'Bita_Zona_Seca_Ref'
).geometry();

Map.centerObject(Rio_Bita_AOI, 8);
Map.addLayer(Bita_FC, {color: 'FF0000'}, 'AOI — Rio Bita Basin', false);


// ============================================================
// VISUALIZATION PARAMETERS
// ============================================================

var vis_SWIR = {
  bands: ['SR_B6'],
  min: 7000,
  max: 25000,
  palette: [
    '08306b',
    '2171b5',
    'a8d8ea',
    'f5f5f5',
    'd4a060',
    'a05020',
    '4d1600'
  ]
};

var vis_inundacion = {
  bands: ['inundacion'], palette: ['ffffff', '08306b']
};

var vis_freq_humedo = {
  bands: ['inundacion'], min: 0, max: 10,
  palette: ['f7fbff', 'c6dbef', '6baed6', '2171b5', '084594']
};

var vis_freq_seco = {
  bands: ['inundacion'], min: 0, max: 10,
  palette: ['fff5eb', 'fdd0a2', 'fd8d3c', 'd94801', '7f2704']
};

var vis_freq_total = {
  bands: ['inundacion'], min: 0, max: 20,
  palette: ['f7f7f7', 'c6dbef', '6baed6', '2171b5', '08519c', '08306b']
};


// ============================================================
// LOAD COMPOSITES FROM ASSETS
// ============================================================

var composites_humedo = ee.ImageCollection(
  ASSET_PATH + 'Bita_composites_humedo'
);

var composites_seco = ee.ImageCollection(
  ASSET_PATH + 'Bita_composites_seco'
);

print('Wet season composites:', composites_humedo);
print('Dry season composites:', composites_seco);


// ============================================================
// MULTI-YEAR REFERENCE SURFACES
// ============================================================

var referencia_humedo = composites_humedo
  .select('SR_B6')
  .median()
  .clip(Rio_Bita_AOI)
  .rename('SR_B6');

var referencia_seco = composites_seco
  .select('SR_B6')
  .median()
  .clip(Rio_Bita_AOI)
  .rename('SR_B6');

Map.addLayer(referencia_humedo, vis_SWIR, 'Reference wet 2015–2024', false);
Map.addLayer(referencia_seco,   vis_SWIR, 'Reference dry 2015–2024', false);


// ============================================================
// REFERENCE GEOMETRY CHECK
// Expected values: SWIR_wet < 10000 | SWIR_dry > 18000
// ============================================================

var comp_ref = composites_humedo
  .filterMetadata('year', 'equals', 2023).first();

print('Reference geometry check (wet 2023)');
print('SWIR_wet:', comp_ref.reduceRegion({
  reducer: ee.Reducer.median(),
  geometry: Zona_Humeda_Ref,
  scale: 30,
  maxPixels: 1e9
}).get('SR_B6'));

print('SWIR_dry:', comp_ref.reduceRegion({
  reducer: ee.Reducer.median(),
  geometry: Zona_Seca_Ref,
  scale: 30,
  maxPixels: 1e9
}).get('SR_B6'));


// ============================================================
// SWIR THRESHOLDING
// ============================================================

var makeFloodMap = function(image) {

  var swir_wet = image.reduceRegion({
    reducer: ee.Reducer.median(),
    geometry: Zona_Humeda_Ref,
    scale: 30,
    maxPixels: 1e9
  }).getNumber('SR_B6');

  var swir_dry = image.reduceRegion({
    reducer: ee.Reducer.median(),
    geometry: Zona_Seca_Ref,
    scale: 30,
    maxPixels: 1e9
  }).getNumber('SR_B6');

  var threshold = swir_wet.add(
    ee.Number(0.3).multiply(
      swir_dry.subtract(swir_wet)
    )
  );

  return image.lt(threshold)
    .rename('inundacion')
    .copyProperties(image, ['year', 'epoca'])
    .set(
      'SWIR_wet', swir_wet,
      'SWIR_dry', swir_dry,
      'SWIR_threshold', threshold
    );
};

var flood_maps_humedo = composites_humedo.map(makeFloodMap);
var flood_maps_seco   = composites_seco.map(makeFloodMap);

print('Flood maps wet season:', flood_maps_humedo);
print('Flood maps dry season:', flood_maps_seco);


// ============================================================
// THRESHOLD CHECK
// ============================================================

ee.List.sequence(2015, 2024).evaluate(function(years) {
  years.forEach(function(yr) {

    var fh = flood_maps_humedo
      .filterMetadata('year', 'equals', yr).first();

    var fs = flood_maps_seco
      .filterMetadata('year', 'equals', yr).first();

    print('Year ' + yr);

    print('Wet | wet:', fh.get('SWIR_wet'),
          '| dry:', fh.get('SWIR_dry'),
          '| threshold:', fh.get('SWIR_threshold'));

    print('Dry | wet:', fs.get('SWIR_wet'),
          '| dry:', fs.get('SWIR_dry'),
          '| threshold:', fs.get('SWIR_threshold'));
  });
});


// ============================================================
// VISUALIZATION
// ============================================================

ee.List.sequence(2015, 2024).evaluate(function(years) {

  years.forEach(function(yr) {

    var fh = flood_maps_humedo
      .filterMetadata('year', 'equals', yr).first();

    var fs = flood_maps_seco
      .filterMetadata('year', 'equals', yr).first();

    Map.addLayer(
      fh.selfMask(),
      vis_inundacion,
      yr + ' — Flood wet',
      false
    );

    Map.addLayer(
      fs.selfMask(),
      vis_inundacion,
      yr + ' — Flood dry',
      false
    );

  });

});
// ============================================================
// FLOOD FREQUENCY MAPS
// ============================================================

var frecuencia_humedo = flood_maps_humedo
  .sum()
  .rename('inundacion')
  .clip(Rio_Bita_AOI);

var frecuencia_seco = flood_maps_seco
  .sum()
  .rename('inundacion')
  .clip(Rio_Bita_AOI);

var frecuencia_total = frecuencia_humedo
  .add(frecuencia_seco)
  .rename('inundacion')
  .clip(Rio_Bita_AOI);


// Visualization

Map.addLayer(
  frecuencia_humedo,
  vis_freq_humedo,
  'Flood frequency — Wet season (2015–2024)',
  true
);

Map.addLayer(
  frecuencia_seco,
  vis_freq_seco,
  'Flood frequency — Dry season (2015–2024)',
  false
);

Map.addLayer(
  frecuencia_total,
  vis_freq_total,
  'Flood frequency — Total (2015–2024)',
  false
);


// ============================================================
// FLOODED AREA PER YEAR
// ============================================================

var pixelArea = ee.Image.pixelArea().divide(10000); // hectares

var areaStats = flood_maps_humedo.merge(flood_maps_seco)
  .map(function(image){

    var area = image
      .multiply(pixelArea)
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: Rio_Bita_AOI,
        scale: 30,
        maxPixels: 1e13
      }).get('inundacion');

    return ee.Feature(null, {
      'year': image.get('year'),
      'season': image.get('epoca'),
      'flood_area_ha': area
    });

  });

print('Flooded area per year', areaStats);


// ============================================================
// EXPORT FREQUENCY MAPS
// ============================================================

Export.image.toAsset({
  image: frecuencia_humedo,
  description: 'Bita_flood_frequency_wet',
  assetId: ASSET_PATH + 'Bita_flood_frequency_wet',
  region: Rio_Bita_AOI,
  scale: 30,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

Export.image.toAsset({
  image: frecuencia_seco,
  description: 'Bita_flood_frequency_dry',
  assetId: ASSET_PATH + 'Bita_flood_frequency_dry',
  region: Rio_Bita_AOI,
  scale: 30,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

Export.image.toAsset({
  image: frecuencia_total,
  description: 'Bita_flood_frequency_total',
  assetId: ASSET_PATH + 'Bita_flood_frequency_total',
  region: Rio_Bita_AOI,
  scale: 30,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});


// ============================================================
// EXPORT AREA TABLE
// ============================================================

Export.table.toDrive({
  collection: areaStats,
  description: 'Bita_flood_area_2015_2024',
  fileFormat: 'CSV'
});
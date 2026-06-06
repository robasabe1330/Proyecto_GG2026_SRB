// ============================================================
// SCRIPT 1 — SEASONAL COMPOSITES GENERATION — RÍO BITA
// Generates seasonal Landsat composites and exports them to Assets
// Method: Wolski et al. (2017) / Inman & Lyons (2020)
// ============================================================


// ============================================================
// **IMPORTANT**
// USER ASSET PATH
// Replace with your own Earth Engine asset path
// ============================================================

var ASSET_PATH = 'projects/user/assets/';


// AOI 
var Bita_FC      = ee.FeatureCollection(ASSET_PATH + 'Vita_ZH');
var Rio_Bita_AOI = Bita_FC.geometry();


// Visualization palette
var vis_SWIR = {
  bands:   ['SR_B6'],
  min:     7000,
  max:     25000,
  palette: [
    '08306b',  // dark blue  — open water (low values)
    '2171b5',  // blue       — flooded vegetation
    'a8d8ea',  // light blue — moderate moisture
    'f5f5f5',  // white      — transition
    'd4a060',  // light brown — dry vegetation
    'a05020',  // brown       — dry soil
    '4d1600'   // dark brown  — very dry soil (high values)
  ]
};


Export.table.toAsset({
  collection:  ee.FeatureCollection(Zona_Humeda_Ref),
  description: 'Bita_Zona_Humeda_Ref',
  assetId:     ASSET_PATH + 'Bita_Zona_Humeda_Ref'
});

Export.table.toAsset({
  collection:  ee.FeatureCollection(Zona_Seca_Ref),
  description: 'Bita_Zona_Seca_Ref',
  assetId:     ASSET_PATH + 'Bita_Zona_Seca_Ref'
});


// ============================================================
// STEP 1A — CLOUD MASKING (C2 T1_L2)
// Bit 3: Cloud shadow | Bit 6: Cloud
// ============================================================

function cloudMaskL89(image) {
  var qa   = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 3).eq(0)
               .and(qa.bitwiseAnd(1 << 6).eq(0));
  return image.updateMask(mask);
}


// ============================================================
// STEP 1B — LOAD LANDSAT 8 AND 9 COLLECTIONS
// Using only SR_B6 (SWIR1 ~1.6 µm)
// ============================================================

var ls8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
            .filterBounds(Rio_Bita_AOI)
            .map(cloudMaskL89)
            .select('SR_B6');

var ls9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
            .filterBounds(Rio_Bita_AOI)
            .map(cloudMaskL89)
            .select('SR_B6');

var ls_merged = ee.ImageCollection(ls8.merge(ls9));
print('Total available L8+L9 images:', ls_merged.size());


// ============================================================
// STEP 1C — GAP FILLING
// ============================================================

var kernel = ee.Kernel.square(10 * 30, 'meters', false);

var GapFill = function(image) {
  var start   = image.date().advance(-1, 'year');
  var end     = image.date().advance(1, 'year');
  var fill    = ls_merged.filterDate(start, end).median();
  var regress = fill.addBands(image).select(
    fill.addBands(image).bandNames().sort()
  );
  var fit = regress.reduceNeighborhood(
    ee.Reducer.linearFit().forEach(image.bandNames()), kernel, null, false
  );
  return image.unmask(
    fill.multiply(fit.select('.*_scale')).add(fit.select('.*_offset')), true
  ).uint16();
};

var ls_filled = ls_merged.map(GapFill);


// ============================================================
// STEP 1D — SEASONAL COMPOSITES
//
// Wet season: July–September
// Dry season: January–March
//
// Generates 20 composites (2015–2024)
// ============================================================

var Date_Start = ee.Date('2015-01-01');
var Date_End   = ee.Date('2024-12-31');
var n_months   = Date_End.difference(Date_Start, 'month').round();


// Function to generate seasonal composites
var makeComposites = function(startMonth, label) {
  var dates = ee.List(
    ee.List.sequence(startMonth, n_months, 12).map(function(n) {
      return Date_Start.advance(n, 'month');
    })
  );
  return ee.ImageCollection(
    dates.map(function(d1) {
      var start = ee.Date(d1);
      var end   = start.advance(3, 'month');
      return ls_filled
        .filterDate(ee.DateRange(start, end))
        .median()
        .clip(Rio_Bita_AOI)
        .uint16()
        .set({
          'startDate': start.format('YYYY-MM-dd'),
          'endDate':   end.format('YYYY-MM-dd'),
          'year':      start.get('year'),
          'epoca':     label
        });
    })
  );
};

var composites_humedo = makeComposites(6, 'humedo');
var composites_seco   = makeComposites(0, 'seco');

var composites_todos = composites_humedo.merge(composites_seco);

print('Wet season composites:', composites_humedo);
print('Dry season composites:', composites_seco);
print('Total composites:', composites_todos);


// ============================================================
// STEP 1E — VISUALIZATION
// ============================================================

ee.List.sequence(2015, 2024).evaluate(function(years) {
  years.forEach(function(yr) {

    var hum = composites_humedo.filterMetadata('year', 'equals', yr);
    var sec = composites_seco.filterMetadata('year', 'equals', yr);

    hum.size().evaluate(function(n) {
      if (n > 0) {
        Map.addLayer(hum.first(), vis_SWIR, yr + ' — Wet (Jul–Sep)', false);
      }
    });

    sec.size().evaluate(function(n) {
      if (n > 0) {
        Map.addLayer(sec.first(), vis_SWIR, yr + ' — Dry (Jan–Mar)', false);
      }
    });
  });

  Map.addLayer(
    composites_humedo.filterMetadata('year', 'equals', 2023).first(),
    vis_SWIR, '2023 — Wet [ACTIVE]', true
  );
});


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
// EXPORT COMPOSITES TO ASSETS
// ============================================================

ee.List.sequence(2015, 2024).evaluate(function(years) {
  years.forEach(function(yr) {
    var comp = composites_humedo
      .filterMetadata('year', 'equals', yr).first();
    Export.image.toAsset({
      image:       comp,
      description: 'Bita_humedo_' + yr,
      assetId:     ASSET_PATH + 'Bita_composites_humedo/Bita_humedo_' + yr,
      region:      Rio_Bita_AOI,
      scale:       30,
      crs:         'EPSG:4326',
      maxPixels:   1e13
    });
  });
});

ee.List.sequence(2015, 2024).evaluate(function(years) {
  years.forEach(function(yr) {
    var comp = composites_seco
      .filterMetadata('year', 'equals', yr).first();
    Export.image.toAsset({
      image:       comp,
      description: 'Bita_seco_' + yr,
      assetId:     ASSET_PATH + 'Bita_composites_seco/Bita_seco_' + yr,
      region:      Rio_Bita_AOI,
      scale:       30,
      crs:         'EPSG:4326',
      maxPixels:   1e13
    });
  });
});
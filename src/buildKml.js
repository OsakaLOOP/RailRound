const buildKMLString = (paths) => {
    let placemarks = '';

    paths.forEach(p => {
        placemarks += `
<Placemark>
  <name>${p.name}</name>
  <LineString>
    <tessellate>1</tessellate>
    <altitudeMode>clampToGround</altitudeMode>
    <coordinates>${p.coordinates}</coordinates>
  </LineString>
</Placemark>`;
    });
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>RailLog Travel Routes</name>
  ${placemarks}
</Document>
</kml>`;
};

export default buildKMLString;
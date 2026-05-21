/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest';
import { loadGeoJson, exportTopology, annotateFeature } from '../rail-graph-v1-mvp/app';
import { SENSEKI_RAIL } from '../rail-graph-v1-mvp/senseki-data';
import { SENSEKI_PF_OVERRIDES } from '../rail-graph-v1-mvp/poc-senseki-pathfinding';

describe('Step 1: Check 775723282 sub-objects', () => {
  it('should print properties and node counts for 775723282 objects', () => {
    // 1. Raw GeoJSON check
    const features = SENSEKI_RAIL.features.filter(f => 
      f.properties?.osm_id === '775723282' || 
      f.properties?.osm_id === '775723282(1)'
    );
    
    console.log(`=== Raw GeoJSON Features ===`);
    features.forEach(f => {
      console.log(`OSM ID: ${f.properties.osm_id}`);
      console.log(`Properties:`, JSON.stringify(f.properties, null, 2));
      if (f.geometry.type === 'LineString') {
        console.log(`Coordinate (node) count: ${f.geometry.coordinates.length}`);
        console.log(`First coordinate:`, f.geometry.coordinates[0]);
        console.log(`Last coordinate:`, f.geometry.coordinates[f.geometry.coordinates.length - 1]);
      }
    });

    // 2. Compiled Topology check
    loadGeoJson(SENSEKI_RAIL);
    Object.entries(SENSEKI_PF_OVERRIDES).forEach(([id, annotation]) => {
      const index = SENSEKI_RAIL.features.findIndex(f => 
        f.properties?.railGraph?.id === id || 
        f.properties?.osm_id === id.replace("osm:way:", "")
      );
      if (index !== -1) {
        annotateFeature(index, annotation as any);
      }
    });

    const topo = exportTopology();
    const edges = topo.edges.filter(e => 
      e.sourceSlice?.sourceFeatureRef === 'osm:way:775723282' ||
      e.sourceSlice?.sourceFeatureRef === 'osm:way:775723282(1)'
    );

    console.log(`=== Compiled Topology Edges ===`);
    edges.forEach(e => {
      console.log(`Edge ID: ${e.id}`);
      console.log(`  Source Ref: ${e.sourceSlice?.sourceFeatureRef}`);
      console.log(`  From Node: ${e.fromNodeRef}`);
      console.log(`  To Node: ${e.toNodeRef}`);
      console.log(`  Traversal: ${e.traversal}`);
      console.log(`  DirectionRole: ${e.directionRole}`);
      console.log(`  Length (m): ${e.lengthMeters}`);
      console.log(`  Coordinate count: ${e.coordinates?.length}`);
    });
  });
});

import type { EntityRef } from "../../rail-graph-v1/primitives";
import type { CrossPatternPath } from "../cross-pattern/types";
import type { UserEvent } from "./types";

export interface PathLike {
  edgeSequence: EntityRef[];
  stationSequence: EntityRef[];
}

export interface OrderedEvent {
  event: UserEvent;
  orderIndex: number;
  subIndex: number;
}

export function aggregateEventsAlongPath(events: UserEvent[], path: PathLike): OrderedEvent[] {
  const out: OrderedEvent[] = [];
  for (const event of events) {
    const anchor = event.anchor;
    if (anchor.kind === "station") {
      const stationIndex = path.stationSequence.indexOf(anchor.stationRef);
      if (stationIndex >= 0) {
        out.push({ event, orderIndex: stationIndex, subIndex: 0 });
      }
      continue;
    }
    const edgeIndex = path.edgeSequence.indexOf(anchor.edgeRef);
    if (edgeIndex >= 0) {
      out.push({
        event,
        orderIndex: edgeIndex,
        subIndex: Math.max(0, Math.min(1, anchor.measure)),
      });
    }
  }
  return out.sort((a, b) =>
    a.orderIndex - b.orderIndex
    || a.subIndex - b.subIndex
    || a.event.id.localeCompare(b.event.id)
  );
}

export function flattenCrossPathToPathLike(crossPath: CrossPatternPath): PathLike {
  const edgeSequence: EntityRef[] = [];
  const stationSequence: EntityRef[] = [];
  for (const hop of crossPath.hops) {
    edgeSequence.push(...hop.edgeSequence);
    for (const stationRef of hop.stationSequence) {
      if (stationSequence[stationSequence.length - 1] !== stationRef) {
        stationSequence.push(stationRef);
      }
    }
  }
  return { edgeSequence, stationSequence };
}

/**
 * RightClickDragSensor — Custom dnd-kit sensor that activates ONLY on right mouse button.
 * Left click remains free for the custom context menu.
 */

import { MouseSensor, type MouseSensorOptions } from "@dnd-kit/core";
import type { MouseEvent } from "react";

export class RightClickMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: (
        { nativeEvent: event }: MouseEvent<Element, globalThis.MouseEvent>,
        _options: MouseSensorOptions,
      ): boolean => {
        // Only activate drag on right mouse button (button === 2)
        return event.button === 2;
      },
    },
  ];
}
import type { SpeakerTemplateOption } from "./types";

export const SPEAKER_TEMPLATE_OPTIONS: SpeakerTemplateOption[] = [
  {
    id: "none",
    label: "No template",
    description: "Use the standard smart crop layout.",
  },
  {
    id: "solo",
    label: "Solo",
    description: "Crop tightly around the active speaker.",
  },
  {
    id: "multi",
    label: "Multi",
    description: "Show the active speaker with the others below.",
  },
];

export const loadCreativeEngine = async () =>
  (await import("@cesdk/engine")).default;

export type CreativeEngineConstructor = Awaited<
  ReturnType<typeof loadCreativeEngine>
>;
export type CreativeEngineInstance = Awaited<
  ReturnType<CreativeEngineConstructor["init"]>
>;

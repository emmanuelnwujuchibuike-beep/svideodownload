/**
 * onnxruntime-node ships its runtime without dist/index.d.ts (the tarball
 * relies on a postinstall step this repo does not run). Its public surface
 * IS onnxruntime-common — InferenceSession, Tensor — so this points the
 * name at those types. server/preflight/detectors.ts is the only importer.
 */
declare module "onnxruntime-node" {
  export * from "onnxruntime-common";
}

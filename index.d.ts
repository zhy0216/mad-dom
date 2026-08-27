export interface MadDomProject {
  readonly name: "mad-dom";
  readonly version: "0.0.1-alpha.0";
  readonly status: "pre-alpha";
  readonly runtime: "bun";
  readonly architecture: "native-memory-arena";
}

export declare const project: MadDomProject;

export declare function createWindow(): never;

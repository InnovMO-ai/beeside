/** Precision's Knowledge Layer client: the ONLY place in Precision that talks to the layer (through its contract). */
export { createDemandPort, createOrientationPort, createResourcesPort, jurisdictionOf } from "./adapters";
export { orientationOffer, topicDrivers, type TopicDriver } from "./drivers";
export type { DemandInput, DemandPort, OrientationAnswer, OrientationPort, RegisteredDemand, ResourceOffer, ResourcesPort } from "./ports";

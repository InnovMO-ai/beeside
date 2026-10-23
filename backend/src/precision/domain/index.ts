/**
 * DOMAIN-A composition: the services behind the Precision API. Pure construction, no I/O at import time.
 */
import type { ConversationStore } from "../conversation";
import { createCenterService, type CenterService } from "./center";
import { createThreadServices, type ThreadServices } from "./conversations";
import type { PrecisionDomainDeps } from "./deps";
import type { FaContextService } from "./fa-context";
import { createServiceMapService, type ServiceMapService } from "./service-map";

export interface PrecisionDomain {
  fa: FaContextService;
  store: ConversationStore;
  center: CenterService;
  serviceMap: ServiceMapService;
  threads: ThreadServices;
}

export function createPrecisionDomain(deps: PrecisionDomainDeps, parts: { fa: FaContextService; store: ConversationStore }): PrecisionDomain {
  return {
    fa: parts.fa,
    store: parts.store,
    center: createCenterService(deps, parts.fa),
    serviceMap: createServiceMapService(deps, parts.fa),
    threads: createThreadServices(deps, parts.fa, parts.store),
  };
}

export * from "./deps";

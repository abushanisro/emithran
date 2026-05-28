import type { ApiSpec } from './api-spec-types';
import { BASE_URL } from './specs/_base';
import { authenticationGroup } from './specs/authentication';
import { profileGroup } from './specs/profile';
import { developerGroup } from './specs/developer';
import { projectsGroup } from './specs/projects';
import { bomsGroup } from './specs/boms';
import { bomItemsGroup } from './specs/bom-items';
import { vendorsGroup } from './specs/vendors';
import { rawMaterialsGroup } from './specs/raw-materials';
import { processesGroup } from './specs/processes';
import { processRoutesGroup } from './specs/process-routes';
import { lsrGroup } from './specs/lsr';
import { mhrGroup } from './specs/mhr';
import { costAnalysisGroup } from './specs/cost-analysis';
import { calculatorsGroup } from './specs/calculators';
import { productionPlanningGroup } from './specs/production-planning';
import { qualityControlGroup } from './specs/quality-control';
import { deliveryGroup } from './specs/delivery';
import { rfqGroup } from './specs/rfq';
import { supplierEvaluationGroup } from './specs/supplier-evaluation';
import { supplierNominationsGroup } from './specs/supplier-nominations';
import { vendorQuotesGroup } from './specs/vendor-quotes';
import { vaveGroup } from './specs/vave';
import { benchmarksGroup } from './specs/benchmarks';

export const API_SPEC: ApiSpec = {
  title: 'Mithran API',
  version: '1.0',
  baseUrl: BASE_URL,
  description:
    'The Mithran API is organized around REST. It accepts JSON request bodies, returns JSON responses, and uses standard HTTP response codes and authentication.',
  authenticationMethods: {
    jwt: {
      description:
        'Pass a Supabase JWT in the Authorization header. Obtain the token by authenticating via Supabase Auth.',
      header: 'Authorization: Bearer <jwt_token>',
    },
    apiKey: {
      description:
        'Pass your Mithran API key in the X-API-Key header. Generate keys in the Developer Portal.',
      header: 'X-API-Key: mk_live_xxxxxxxxxxxxxxxxxxxx',
    },
  },
  groups: [
    authenticationGroup,
    profileGroup,
    developerGroup,
    projectsGroup,
    bomsGroup,
    bomItemsGroup,
    vendorsGroup,
    rawMaterialsGroup,
    processesGroup,
    processRoutesGroup,
    lsrGroup,
    mhrGroup,
    costAnalysisGroup,
    calculatorsGroup,
    productionPlanningGroup,
    qualityControlGroup,
    deliveryGroup,
    rfqGroup,
    supplierEvaluationGroup,
    supplierNominationsGroup,
    vendorQuotesGroup,
    vaveGroup,
    benchmarksGroup,
  ],
};

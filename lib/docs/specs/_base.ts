import { settingWithDevDefault } from '@/lib/utils/required-setting';

// The API host shown in the docs examples. Required in production: there is no
// hard-coded public host to fall back to.
const BASE_URL = settingWithDevDefault(
  process.env.NEXT_PUBLIC_API_GATEWAY_URL,
  'NEXT_PUBLIC_API_GATEWAY_URL',
  'http://localhost:4000',
);
export { BASE_URL };

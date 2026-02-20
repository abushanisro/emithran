export interface User {
  id: string;
  email: string;
  role?: string;
  [key: string]: any; // For additional Supabase user properties
}
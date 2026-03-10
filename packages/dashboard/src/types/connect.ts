export interface SavedCredential {
  id: string
  label: string
  token: string
  platform: 'github' | 'azure'
}

export interface VcsInstallation {
  id: string
  platform: string
  display_name: string | null
  account_login: string | null
  account_type: string | null
  github_app_id: string | null
  github_app_installation_id: string | null
  azure_client_id: string | null
  azure_tenant_id: string | null
  azure_org_url: string | null
  azure_connected: boolean
  created_at: string
}

export type AppRepo = {
  id: number
  name: string
  fullName: string
  url: string
  private: boolean
}

export type AppInstallationMeta = {
  accountLogin: string | null
  accountType: string | null
  repositorySelection: string
}

/** State for a single installation's repo picker dropdown */
export interface PickerState {
  repos: AppRepo[]
  meta: AppInstallationMeta | null
  loading: boolean
  error: string
  open: boolean
  search: string
  selected: AppRepo | null
  connectError: string
}

export const DEFAULT_PICKER_STATE: PickerState = {
  repos: [],
  meta: null,
  loading: false,
  error: '',
  open: false,
  search: '',
  selected: null,
  connectError: '',
}

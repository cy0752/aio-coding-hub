import type {
  ClaudeModels,
  CliKey,
  ProviderSummary,
} from "../../services/providers/providers";
import type { ProviderEditorDialogFormInput } from "../../schemas/providerEditorDialog";
import type { BaseUrlRow, ProviderBaseUrlMode } from "./types";

/** Provider identity and lifecycle */
export type ProviderActionContext = {
  mode: "create" | "edit";
  cliKey: CliKey;
  editingProviderId: number | null;
  editProvider: ProviderSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (cliKey: CliKey) => void;
};

/** OAuth status payload shared by auth-related fields */
export type OAuthStatusValue = {
  connected: boolean;
  provider_type?: string;
  email?: string;
  expires_at?: number;
  has_refresh_token?: boolean;
} | null;

/** Authentication and bridge state */
export type AuthActionContext = {
  authMode: "api_key" | "oauth" | "cx2cc";
  oauthStatus: OAuthStatusValue;
  setOauthStatus: (v: OAuthStatusValue) => void;
  oauthLoading: boolean;
  setOauthLoading: (v: boolean) => void;
  cx2ccSourceValue: string;
  isCodexGatewaySource: boolean;
  sourceProviderId: number | null;
  selectedCx2ccSourceProvider: ProviderSummary | null;
};

/** Form data and UI state */
export type FormActionContext = {
  saving: boolean;
  setSaving: (v: boolean) => void;
  baseUrlMode: ProviderBaseUrlMode;
  baseUrlRows: BaseUrlRow[];
  tags: string[];
  claudeModels: ClaudeModels;
  streamIdleTimeoutSeconds: string;
  apiKeyDirty: boolean;
  apiKeyValue: string;
  savedApiKey: string | null;
  setSavedApiKey: (v: string | null) => void;
  fetchingApiKey: boolean;
  setFetchingApiKey: (v: boolean) => void;
  apiKeyFetchedRef: React.MutableRefObject<boolean>;
  apiKeyFetchPromiseRef: React.MutableRefObject<Promise<string | null> | null>;
  apiKeyFetchErrorRef: React.MutableRefObject<boolean>;
  form: {
    getValues: () => ProviderEditorDialogFormInput;
    setValue: (
      name: keyof ProviderEditorDialogFormInput,
      value: string | boolean,
      options?: { shouldDirty?: boolean; shouldTouch?: boolean; shouldValidate?: boolean }
    ) => void;
  };
};

/** Complete ActionContext = intersection of all sub-contexts */
export type ActionContext = ProviderActionContext & AuthActionContext & FormActionContext;

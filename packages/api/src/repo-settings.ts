export type PRDescriptionUpdateMode = 'created_only' | 'created_and_updated';
export type PRDescriptionPublishMode = 'replace_pr' | 'comment';

export interface RepoPRDescriptionSettings {
  enabled: boolean;
  updateMode: PRDescriptionUpdateMode;
  publishMode: PRDescriptionPublishMode;
  preserveOriginal: boolean;
  useMarkers: boolean;
  publishLabels: boolean;
}

export interface RepoPRDescriptionOverrides {
  enabled?: boolean | null;
  updateMode?: PRDescriptionUpdateMode | null;
  publishMode?: PRDescriptionPublishMode | null;
  preserveOriginal?: boolean | null;
  useMarkers?: boolean | null;
  publishLabels?: boolean | null;
}

export const DEFAULT_REPO_PR_DESCRIPTION_SETTINGS: RepoPRDescriptionSettings = {
  enabled: true,
  updateMode: 'created_only',
  publishMode: 'replace_pr',
  preserveOriginal: true,
  useMarkers: false,
  publishLabels: true,
};

export function normalizeRepoPRDescriptionSettings(
  row: Partial<{
    pr_description_enabled: boolean;
    pr_description_update_mode: string;
    pr_description_publish_mode: string;
    pr_description_preserve_original: boolean;
    pr_description_use_markers: boolean;
    pr_description_publish_labels: boolean;
  }> | null | undefined
): RepoPRDescriptionSettings {
  const updateMode = row?.pr_description_update_mode === 'created_and_updated'
    ? 'created_and_updated'
    : 'created_only';
  const publishMode = row?.pr_description_publish_mode === 'comment'
    ? 'comment'
    : 'replace_pr';

  return {
    enabled: row?.pr_description_enabled ?? DEFAULT_REPO_PR_DESCRIPTION_SETTINGS.enabled,
    updateMode,
    publishMode,
    preserveOriginal: row?.pr_description_preserve_original ?? DEFAULT_REPO_PR_DESCRIPTION_SETTINGS.preserveOriginal,
    useMarkers: row?.pr_description_use_markers ?? DEFAULT_REPO_PR_DESCRIPTION_SETTINGS.useMarkers,
    publishLabels: row?.pr_description_publish_labels ?? DEFAULT_REPO_PR_DESCRIPTION_SETTINGS.publishLabels,
  };
}

export function resolveRepoPRDescriptionSettings(
  orgSettings: RepoPRDescriptionSettings,
  repoOverrides: RepoPRDescriptionOverrides | null | undefined
): RepoPRDescriptionSettings {
  return {
    enabled: repoOverrides?.enabled ?? orgSettings.enabled,
    updateMode: repoOverrides?.updateMode ?? orgSettings.updateMode,
    publishMode: repoOverrides?.publishMode ?? orgSettings.publishMode,
    preserveOriginal: repoOverrides?.preserveOriginal ?? orgSettings.preserveOriginal,
    useMarkers: repoOverrides?.useMarkers ?? orgSettings.useMarkers,
    publishLabels: repoOverrides?.publishLabels ?? orgSettings.publishLabels,
  };
}

export function extractOrgIdentity(platform: 'github' | 'azure', repoUrl: string): { orgKey: string; orgName: string } {
  try {
    const u = new URL(repoUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const orgName = platform === 'github' ? (parts[0] ?? 'unknown') : (parts[0] ?? 'unknown');
    return { orgKey: `${platform}:${orgName.toLowerCase()}`, orgName };
  } catch {
    return { orgKey: `${platform}:unknown`, orgName: 'unknown' };
  }
}

export type CreatorStatus = 'new' | 'contacted' | 'replied' | 'qualified' | 'rejected' | 'converted';
export type Platform = 'youtube' | 'x' | 'instagram' | 'tiktok' | 'twitch' | 'discord' | 'telegram' | 'linkedin';
export type OutreachChannel = 'email' | 'dm' | 'form' | 'other';
export type OutreachStatus = 'draft' | 'queued' | 'sent' | 'opened' | 'replied' | 'bounced';
export type DiscoveryStatus = 'running' | 'completed' | 'failed';

export interface Creator {
  id: string;
  name: string;
  slug: string | null;
  website: string | null;
  public_email: string | null;
  public_phone: string | null;
  total_followers: number;
  has_course: boolean;
  has_discord: boolean;
  has_telegram: boolean;
  promoting_prop_firms: boolean;
  prop_firms_mentioned: string[];
  instagram_url: string | null;
  linkedin_url: string | null;
  lead_score: number;
  confidence_score: number;
  notes: string | null;
  status: CreatorStatus;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreatorAccount {
  id: string;
  creator_id: string;
  platform: Platform;
  handle: string;
  profile_url: string | null;
  followers: number;
  platform_id: string | null;
  bio: string | null;
  verified: boolean;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatorPost {
  id: string;
  creator_id: string;
  account_id: string | null;
  platform: Platform;
  post_url: string | null;
  title: string | null;
  content_snippet: string | null;
  views: number;
  likes: number;
  comments: number;
  published_at: string | null;
  mentions_prop_firm: boolean;
  mentions_course: boolean;
  created_at: string;
}

export interface DailyDiscovery {
  id: string;
  run_date: string;
  platform: Platform;
  new_creators_found: number;
  existing_creators_updated: number;
  errors: string[];
  started_at: string;
  completed_at: string | null;
  status: DiscoveryStatus;
}

export interface Outreach {
  id: string;
  creator_id: string;
  channel: OutreachChannel;
  subject: string | null;
  body: string | null;
  sent_at: string | null;
  status: OutreachStatus;
  response: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

// Extended types for UI
export interface CreatorWithAccounts extends Creator {
  accounts: CreatorAccount[];
}

export interface CreatorDetail extends CreatorWithAccounts {
  posts: CreatorPost[];
  outreach_history: Outreach[];
}

export interface DashboardStats {
  total_creators: number;
  new_today: number;
  total_with_email: number;
  avg_lead_score: number;
  outreach_sent: number;
  outreach_replied: number;
  platforms: { platform: string; count: number }[];
}

export interface CreatorFilters {
  platform?: Platform;
  min_followers?: number;
  max_followers?: number;
  has_course?: boolean;
  has_discord?: boolean;
  has_telegram?: boolean;
  promoting_prop_firms?: boolean;
  has_instagram?: boolean;
  has_linkedin?: boolean;
  new_today?: boolean;
  status?: CreatorStatus;
  search?: string;
  sort_by?: 'lead_score' | 'followers' | 'created_at' | 'first_seen_at' | 'name';
  sort_order?: 'asc' | 'desc';
}

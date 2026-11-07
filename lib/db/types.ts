// Mirrors `pnpm supabase gen types typescript --local > lib/db/types.ts`.
// Regenerate after changing supabase/migrations.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)";
  };
  public: {
    Tables: {
      ai_generation_logs: {
        Row: {
          created_at: string;
          details: Json | null;
          error_code: string;
          id: number;
          job_id: string | null;
          message: string | null;
          prompt: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          details?: Json | null;
          error_code: string;
          id?: never;
          job_id?: string | null;
          message?: string | null;
          prompt?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          details?: Json | null;
          error_code?: string;
          id?: never;
          job_id?: string | null;
          message?: string | null;
          prompt?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      credit_ledger: {
        Row: {
          balance_after: number;
          created_at: string;
          delta: number;
          id: number;
          idempotency_key: string;
          reason: string;
          user_id: string;
        };
        Insert: {
          balance_after: number;
          created_at?: string;
          delta: number;
          id?: never;
          idempotency_key: string;
          reason: string;
          user_id: string;
        };
        Update: {
          balance_after?: number;
          created_at?: string;
          delta?: number;
          id?: never;
          idempotency_key?: string;
          reason?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      exports: {
        Row: {
          completed_at: string | null;
          created_at: string;
          credits_spent: number;
          format: string;
          id: string;
          project_id: string;
          status: string;
          storage_path: string;
          user_id: string;
          watermarked: boolean;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          credits_spent: number;
          format: string;
          id: string;
          project_id: string;
          status?: string;
          storage_path: string;
          user_id: string;
          watermarked: boolean;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          credits_spent?: number;
          format?: string;
          id?: string;
          project_id?: string;
          status?: string;
          storage_path?: string;
          user_id?: string;
          watermarked?: boolean;
        };
        Relationships: [];
      };
      flyer_projects: {
        Row: {
          canvas: Json;
          created_at: string;
          format: string;
          generation_id: string | null;
          id: string;
          revision: number;
          thumbnail_url: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          canvas: Json;
          created_at?: string;
          format: string;
          generation_id?: string | null;
          id?: string;
          revision?: number;
          thumbnail_url?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          canvas?: Json;
          created_at?: string;
          format?: string;
          generation_id?: string | null;
          id?: string;
          revision?: number;
          thumbnail_url?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      generation_jobs: {
        Row: {
          error_message: string | null;
          heartbeat_at: string | null;
          result: Json | null;
          stage: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          credits_spent: number;
          error_code: string | null;
          format: string;
          id: string;
          intent: string;
          project_id: string | null;
          prompt: string;
          status: string;
          user_id: string;
          variations: Json;
        };
        Insert: {
          error_message?: string | null;
          heartbeat_at?: string | null;
          result?: Json | null;
          stage?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          credits_spent?: number;
          error_code?: string | null;
          format: string;
          id?: string;
          intent: string;
          project_id?: string | null;
          prompt: string;
          status?: string;
          user_id: string;
          variations?: Json;
        };
        Update: {
          error_message?: string | null;
          heartbeat_at?: string | null;
          result?: Json | null;
          stage?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          credits_spent?: number;
          error_code?: string | null;
          format?: string;
          id?: string;
          intent?: string;
          project_id?: string | null;
          prompt?: string;
          status?: string;
          user_id?: string;
          variations?: Json;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: { hits: number; key: string; window_start: string };
        Insert: { hits?: number; key: string; window_start: string };
        Update: { hits?: number; key?: string; window_start?: string };
        Relationships: [];
      };
      profiles: {
        Row: {
          billing_interval: Database["public"]["Enums"]["billing_interval"] | null;
          created_at: string;
          credits: number;
          current_period_end: string | null;
          email: string;
          id: string;
          plan: Database["public"]["Enums"]["plan_tier"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null;
          created_at?: string;
          credits?: number;
          current_period_end?: string | null;
          email?: string;
          id: string;
          plan?: Database["public"]["Enums"]["plan_tier"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: {
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null;
          created_at?: string;
          credits?: number;
          current_period_end?: string | null;
          email?: string;
          id?: string;
          plan?: Database["public"]["Enums"]["plan_tier"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      stripe_events: {
        Row: { id: string; processed_at: string; type: string };
        Insert: { id: string; processed_at?: string; type: string };
        Update: { id?: string; processed_at?: string; type?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      add_credits: {
        Args: { p_amount: number; p_idempotency_key: string; p_reason: string; p_user_id: string };
        Returns: number;
      };
      deduct_credits: {
        Args: { p_amount: number; p_idempotency_key: string; p_reason: string; p_user_id: string };
        Returns: number;
      };
      fail_stale_generation_jobs: { Args: never; Returns: number };
      purge_expired_free_projects: { Args: never; Returns: number };
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: { allowed: boolean; remaining: number; reset_at: string }[];
      };
    };
    Enums: {
      billing_interval: "month" | "year";
      plan_tier: "free" | "pro" | "max";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];

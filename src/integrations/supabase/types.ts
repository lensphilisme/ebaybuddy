export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          category: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["log_level"]
          message: string
          metadata: Json
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message: string
          metadata?: Json
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          allow_bold_title: boolean
          allow_promoted_listings: boolean
          allow_subtitle: boolean
          created_at: string
          ebay_fee_buffer_percent: number
          end_test_listings_after_success: boolean
          id: string
          live_listing_enabled: boolean
          markup_percent: number
          max_listing_quantity: number
          min_profit_usd: number
          optimizer_low_views_days: number
          optimizer_no_sales_days: number
          optimizer_poor_exposure_days: number
          payment_fee_buffer_percent: number
          preflight_required: boolean
          round_to: number
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_bold_title?: boolean
          allow_promoted_listings?: boolean
          allow_subtitle?: boolean
          created_at?: string
          ebay_fee_buffer_percent?: number
          end_test_listings_after_success?: boolean
          id?: string
          live_listing_enabled?: boolean
          markup_percent?: number
          max_listing_quantity?: number
          min_profit_usd?: number
          optimizer_low_views_days?: number
          optimizer_no_sales_days?: number
          optimizer_poor_exposure_days?: number
          payment_fee_buffer_percent?: number
          preflight_required?: boolean
          round_to?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_bold_title?: boolean
          allow_promoted_listings?: boolean
          allow_subtitle?: boolean
          created_at?: string
          ebay_fee_buffer_percent?: number
          end_test_listings_after_success?: boolean
          id?: string
          live_listing_enabled?: boolean
          markup_percent?: number
          max_listing_quantity?: number
          min_profit_usd?: number
          optimizer_low_views_days?: number
          optimizer_no_sales_days?: number
          optimizer_poor_exposure_days?: number
          payment_fee_buffer_percent?: number
          preflight_required?: boolean
          round_to?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cj_products_cache: {
        Row: {
          category_id: string | null
          cj_product_id: string
          created_at: string
          id: string
          image_urls: string[]
          is_listed: boolean
          price: number
          raw: Json
          supplier_id: string | null
          title: string
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          category_id?: string | null
          cj_product_id: string
          created_at?: string
          id?: string
          image_urls?: string[]
          is_listed?: boolean
          price?: number
          raw?: Json
          supplier_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          category_id?: string | null
          cj_product_id?: string
          created_at?: string
          id?: string
          image_urls?: string[]
          is_listed?: boolean
          price?: number
          raw?: Json
          supplier_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: []
      }
      ebay_listings: {
        Row: {
          cj_landed_cost: number | null
          cj_product_id: string | null
          clicks: number
          created_at: string
          currency: string
          draft_id: string | null
          ebay_item_id: string | null
          ebay_offer_id: string | null
          ended_at: string | null
          id: string
          last_traffic_check: string | null
          listed_at: string
          marketplace_id: string
          price: number
          sales: number
          sku: string
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at: string
          user_id: string
          views: number
        }
        Insert: {
          cj_landed_cost?: number | null
          cj_product_id?: string | null
          clicks?: number
          created_at?: string
          currency?: string
          draft_id?: string | null
          ebay_item_id?: string | null
          ebay_offer_id?: string | null
          ended_at?: string | null
          id?: string
          last_traffic_check?: string | null
          listed_at?: string
          marketplace_id?: string
          price?: number
          sales?: number
          sku: string
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at?: string
          user_id: string
          views?: number
        }
        Update: {
          cj_landed_cost?: number | null
          cj_product_id?: string | null
          clicks?: number
          created_at?: string
          currency?: string
          draft_id?: string | null
          ebay_item_id?: string | null
          ebay_offer_id?: string | null
          ended_at?: string | null
          id?: string
          last_traffic_check?: string | null
          listed_at?: string
          marketplace_id?: string
          price?: number
          sales?: number
          sku?: string
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          updated_at?: string
          user_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "ebay_listings_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "listing_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          created_at: string
          credentials: Json
          environment: string
          id: string
          is_active: boolean
          label: string | null
          last_error: string | null
          last_validated_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credentials?: Json
          environment?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_error?: string | null
          last_validated_at?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credentials?: Json
          environment?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_error?: string | null
          last_validated_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      listing_drafts: {
        Row: {
          audit_reason: string | null
          brand: string | null
          bullet_features: string[]
          category_id: string | null
          cj_product_id: string
          cj_variant_id: string | null
          condition: string
          created_at: string
          description: string
          duplicate_decision: Json | null
          ebay_listing_id: string | null
          id: string
          images: Json
          item_specifics: Json
          market_comparison: Json | null
          model: string | null
          price: number
          profit: Json
          quantity: number
          sku: string
          status: Database["public"]["Enums"]["draft_status"]
          subtitle: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audit_reason?: string | null
          brand?: string | null
          bullet_features?: string[]
          category_id?: string | null
          cj_product_id: string
          cj_variant_id?: string | null
          condition?: string
          created_at?: string
          description?: string
          duplicate_decision?: Json | null
          ebay_listing_id?: string | null
          id?: string
          images?: Json
          item_specifics?: Json
          market_comparison?: Json | null
          model?: string | null
          price?: number
          profit?: Json
          quantity?: number
          sku: string
          status?: Database["public"]["Enums"]["draft_status"]
          subtitle?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audit_reason?: string | null
          brand?: string | null
          bullet_features?: string[]
          category_id?: string | null
          cj_product_id?: string
          cj_variant_id?: string | null
          condition?: string
          created_at?: string
          description?: string
          duplicate_decision?: Json | null
          ebay_listing_id?: string | null
          id?: string
          images?: Json
          item_specifics?: Json
          market_comparison?: Json | null
          model?: string | null
          price?: number
          profit?: Json
          quantity?: number
          sku?: string
          status?: Database["public"]["Enums"]["draft_status"]
          subtitle?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_ebay_marketplace: string
          display_name: string | null
          ebay_environment: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_ebay_marketplace?: string
          display_name?: string | null
          ebay_environment?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_ebay_marketplace?: string
          display_name?: string | null
          ebay_environment?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      draft_status: "pending" | "approved" | "rejected" | "pushed" | "failed"
      integration_provider: "ebay" | "cj" | "ai"
      listing_status: "active" | "ended" | "sold" | "error"
      log_level: "info" | "warn" | "error" | "success"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      draft_status: ["pending", "approved", "rejected", "pushed", "failed"],
      integration_provider: ["ebay", "cj", "ai"],
      listing_status: ["active", "ended", "sold", "error"],
      log_level: ["info", "warn", "error", "success"],
    },
  },
} as const

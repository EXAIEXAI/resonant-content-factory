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
      channels: {
        Row: {
          active: boolean
          category: string
          created_at: string
          external_id: string | null
          id: string
          last_polled_at: string | null
          platform: string
          subscribers: number | null
          title: string
          url: string
          user_id: string
          weight_factors: Json
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          external_id?: string | null
          id?: string
          last_polled_at?: string | null
          platform: string
          subscribers?: number | null
          title: string
          url: string
          user_id: string
          weight_factors?: Json
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          external_id?: string | null
          id?: string
          last_polled_at?: string | null
          platform?: string
          subscribers?: number | null
          title?: string
          url?: string
          user_id?: string
          weight_factors?: Json
        }
        Relationships: []
      }
      content_outputs: {
        Row: {
          created_at: string
          created_by: string | null
          edited_text: string | null
          format: string
          generated_text: string | null
          id: string
          material_id: string | null
          status: string
          topic_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          edited_text?: string | null
          format: string
          generated_text?: string | null
          id?: string
          material_id?: string | null
          status?: string
          topic_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          edited_text?: string | null
          format?: string
          generated_text?: string | null
          id?: string
          material_id?: string | null
          status?: string
          topic_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_outputs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_outputs_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      digests: {
        Row: {
          category: string
          content_json: Json | null
          created_at: string
          created_by: string | null
          id: string
          material_ids: string[] | null
          scheduled_at: string | null
          status: string
          title: string
        }
        Insert: {
          category?: string
          content_json?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          material_ids?: string[] | null
          scheduled_at?: string | null
          status?: string
          title: string
        }
        Update: {
          category?: string
          content_json?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          material_ids?: string[] | null
          scheduled_at?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      expert_positions: {
        Row: {
          audio_url: string | null
          created_at: string
          expert_id: string | null
          id: string
          linked_thesis: string | null
          material_id: string
          reaction_type: string | null
          timecode: string | null
          transcript: string | null
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          expert_id?: string | null
          id?: string
          linked_thesis?: string | null
          material_id: string
          reaction_type?: string | null
          timecode?: string | null
          transcript?: string | null
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          expert_id?: string | null
          id?: string
          linked_thesis?: string | null
          material_id?: string
          reaction_type?: string | null
          timecode?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_positions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connections: {
        Row: {
          connected_at: string
          drive_access_token: string | null
          drive_connected_at: string | null
          drive_email: string | null
          drive_folder_id: string | null
          drive_refresh_token: string | null
          drive_scopes: string | null
          drive_token_expires_at: string | null
          google_email: string | null
          id: string
          scopes: string | null
          user_id: string
          youtube_access_token: string | null
          youtube_connected_at: string | null
          youtube_email: string | null
          youtube_refresh_token: string | null
          youtube_scopes: string | null
          youtube_token_expires_at: string | null
        }
        Insert: {
          connected_at?: string
          drive_access_token?: string | null
          drive_connected_at?: string | null
          drive_email?: string | null
          drive_folder_id?: string | null
          drive_refresh_token?: string | null
          drive_scopes?: string | null
          drive_token_expires_at?: string | null
          google_email?: string | null
          id?: string
          scopes?: string | null
          user_id: string
          youtube_access_token?: string | null
          youtube_connected_at?: string | null
          youtube_email?: string | null
          youtube_refresh_token?: string | null
          youtube_scopes?: string | null
          youtube_token_expires_at?: string | null
        }
        Update: {
          connected_at?: string
          drive_access_token?: string | null
          drive_connected_at?: string | null
          drive_email?: string | null
          drive_folder_id?: string | null
          drive_refresh_token?: string | null
          drive_scopes?: string | null
          drive_token_expires_at?: string | null
          google_email?: string | null
          id?: string
          scopes?: string | null
          user_id?: string
          youtube_access_token?: string | null
          youtube_connected_at?: string | null
          youtube_email?: string | null
          youtube_refresh_token?: string | null
          youtube_scopes?: string | null
          youtube_token_expires_at?: string | null
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          created_at: string
          drive_folder_id: string | null
          id: string
          last_sync_at: string | null
          last_sync_count: number
          telegram_chat_id: string | null
          telegram_last_sent_at: string | null
          updated_at: string
          user_id: string
          webhook_secret: string
          youtube_api_key: string | null
          youtube_playlist_id: string | null
        }
        Insert: {
          created_at?: string
          drive_folder_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_count?: number
          telegram_chat_id?: string | null
          telegram_last_sent_at?: string | null
          updated_at?: string
          user_id: string
          webhook_secret?: string
          youtube_api_key?: string | null
          youtube_playlist_id?: string | null
        }
        Update: {
          created_at?: string
          drive_folder_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_count?: number
          telegram_chat_id?: string | null
          telegram_last_sent_at?: string | null
          updated_at?: string
          user_id?: string
          webhook_secret?: string
          youtube_api_key?: string | null
          youtube_playlist_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      raw_materials: {
        Row: {
          added_by: string | null
          category: string | null
          channel_id: string | null
          channel_title: string | null
          chapters: Json
          comments_count: number | null
          created_at: string
          drive_file_id: string | null
          drive_file_url: string | null
          duration_seconds: number | null
          engagement_score: number | null
          expert_pick: boolean
          external_id: string | null
          id: string
          is_manual: boolean
          key_points: Json | null
          promoted_to_radar: boolean
          published_at: string | null
          raw_transcript: string | null
          reactions: number | null
          review_generated_at: string | null
          review_md: string | null
          source_type: string
          status: string
          summary: string | null
          thumbnail_url: string | null
          title: string
          transcript_segments: Json
          url: string | null
          user_id: string
          views: number | null
        }
        Insert: {
          added_by?: string | null
          category?: string | null
          channel_id?: string | null
          channel_title?: string | null
          chapters?: Json
          comments_count?: number | null
          created_at?: string
          drive_file_id?: string | null
          drive_file_url?: string | null
          duration_seconds?: number | null
          engagement_score?: number | null
          expert_pick?: boolean
          external_id?: string | null
          id?: string
          is_manual?: boolean
          key_points?: Json | null
          promoted_to_radar?: boolean
          published_at?: string | null
          raw_transcript?: string | null
          reactions?: number | null
          review_generated_at?: string | null
          review_md?: string | null
          source_type?: string
          status?: string
          summary?: string | null
          thumbnail_url?: string | null
          title: string
          transcript_segments?: Json
          url?: string | null
          user_id: string
          views?: number | null
        }
        Update: {
          added_by?: string | null
          category?: string | null
          channel_id?: string | null
          channel_title?: string | null
          chapters?: Json
          comments_count?: number | null
          created_at?: string
          drive_file_id?: string | null
          drive_file_url?: string | null
          duration_seconds?: number | null
          engagement_score?: number | null
          expert_pick?: boolean
          external_id?: string | null
          id?: string
          is_manual?: boolean
          key_points?: Json | null
          promoted_to_radar?: boolean
          published_at?: string | null
          raw_transcript?: string | null
          reactions?: number | null
          review_generated_at?: string | null
          review_md?: string | null
          source_type?: string
          status?: string
          summary?: string | null
          thumbnail_url?: string | null
          title?: string
          transcript_segments?: Json
          url?: string | null
          user_id?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_materials_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      style_templates: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
          prompt_body: string | null
          purpose: string
          rules_json: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          name: string
          prompt_body?: string | null
          purpose?: string
          rules_json?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
          prompt_body?: string | null
          purpose?: string
          rules_json?: Json | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          angles: Json
          chosen_angle: string | null
          created_at: string
          created_by: string | null
          id: string
          selected_material_ids: string[]
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          angles?: Json
          chosen_angle?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          selected_material_ids?: string[]
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          angles?: Json
          chosen_angle?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          selected_material_ids?: string[]
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      app_role: "admin" | "product_owner" | "expert" | "editor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "product_owner", "expert", "editor"],
    },
  },
} as const

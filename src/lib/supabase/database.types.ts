export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      amenities: {
        Row: {
          created_at: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          meta: Json
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          meta?: Json
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          meta?: Json
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      availability: {
        Row: {
          created_at: string
          date_range: unknown
          id: string
          reason: string | null
          vessel_id: string
        }
        Insert: {
          created_at?: string
          date_range: unknown
          id?: string
          reason?: string | null
          vessel_id: string
        }
        Update: {
          created_at?: string
          date_range?: unknown
          id?: string
          reason?: string | null
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancellation_reason: string | null
          client_id: string
          created_at: string
          currency: string
          date_range: unknown
          guests_count: number
          id: string
          payment_method: Database["public"]["Enums"]["payment_provider"] | null
          price_minor: number
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          vessel_id: string
        }
        Insert: {
          cancellation_reason?: string | null
          client_id: string
          created_at?: string
          currency?: string
          date_range: unknown
          guests_count: number
          id?: string
          payment_method?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          price_minor: number
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          vessel_id: string
        }
        Update: {
          cancellation_reason?: string | null
          client_id?: string
          created_at?: string
          currency?: string
          date_range?: unknown
          guests_count?: number
          id?: string
          payment_method?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          price_minor?: number
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_intents: {
        Row: {
          confirmed_at: string | null
          contact_capability: Database["public"]["Enums"]["search_contact_capability"]
          created_at: string
          date_from: string | null
          date_to: string | null
          delivery_channel: string | null
          delivery_reference: string | null
          external_vessel_id: string
          guests: number | null
          id: string
          index_id: string | null
          message_draft: string | null
          message_sent: string | null
          sent_at: string | null
          source_id: string
          status: Database["public"]["Enums"]["intent_status"]
          type: Database["public"]["Enums"]["intent_type"]
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          contact_capability: Database["public"]["Enums"]["search_contact_capability"]
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          delivery_channel?: string | null
          delivery_reference?: string | null
          external_vessel_id: string
          guests?: number | null
          id?: string
          index_id?: string | null
          message_draft?: string | null
          message_sent?: string | null
          sent_at?: string | null
          source_id: string
          status?: Database["public"]["Enums"]["intent_status"]
          type: Database["public"]["Enums"]["intent_type"]
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          contact_capability?: Database["public"]["Enums"]["search_contact_capability"]
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          delivery_channel?: string | null
          delivery_reference?: string | null
          external_vessel_id?: string
          guests?: number | null
          id?: string
          index_id?: string | null
          message_draft?: string | null
          message_sent?: string | null
          sent_at?: string | null
          source_id?: string
          status?: Database["public"]["Enums"]["intent_status"]
          type?: Database["public"]["Enums"]["intent_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_intents_index_id_fkey"
            columns: ["index_id"]
            isOneToOne: false
            referencedRelation: "external_vessel_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_intents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          profile_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          profile_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id?: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      external_vessel_index: {
        Row: {
          amenities: string[]
          available_from: string | null
          available_to: string | null
          cabins: number | null
          city: string | null
          content_hash: string | null
          country: string | null
          created_at: string
          currency: string | null
          description: string | null
          external_id: string
          extracted: Json
          field_provenance: Json
          guests: number | null
          id: string
          identity_match_method:
            | Database["public"]["Enums"]["vessel_identity_match_method"]
            | null
          identity_match_score: number | null
          image: string | null
          images: Json
          indexed_at: string
          last_checked_at: string
          last_extracted_at: string
          last_seen_at: string
          latitude: number | null
          length_meters: number | null
          longitude: number | null
          manufacturer: string | null
          marina: string | null
          model: string | null
          name: string | null
          price_minor: number | null
          price_to_minor: number | null
          price_unit: Database["public"]["Enums"]["price_unit"] | null
          region: string | null
          source_id: string
          updated_at: string
          url: string
          vessel_identity_id: string | null
          vessel_type: Database["public"]["Enums"]["vessel_type"] | null
          vessel_type_raw: string | null
          year: number | null
        }
        Insert: {
          amenities?: string[]
          available_from?: string | null
          available_to?: string | null
          cabins?: number | null
          city?: string | null
          content_hash?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id: string
          extracted?: Json
          field_provenance?: Json
          guests?: number | null
          id?: string
          identity_match_method?:
            | Database["public"]["Enums"]["vessel_identity_match_method"]
            | null
          identity_match_score?: number | null
          image?: string | null
          images?: Json
          indexed_at: string
          last_checked_at: string
          last_extracted_at?: string
          last_seen_at: string
          latitude?: number | null
          length_meters?: number | null
          longitude?: number | null
          manufacturer?: string | null
          marina?: string | null
          model?: string | null
          name?: string | null
          price_minor?: number | null
          price_to_minor?: number | null
          price_unit?: Database["public"]["Enums"]["price_unit"] | null
          region?: string | null
          source_id: string
          updated_at?: string
          url: string
          vessel_identity_id?: string | null
          vessel_type?: Database["public"]["Enums"]["vessel_type"] | null
          vessel_type_raw?: string | null
          year?: number | null
        }
        Update: {
          amenities?: string[]
          available_from?: string | null
          available_to?: string | null
          cabins?: number | null
          city?: string | null
          content_hash?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id?: string
          extracted?: Json
          field_provenance?: Json
          guests?: number | null
          id?: string
          identity_match_method?:
            | Database["public"]["Enums"]["vessel_identity_match_method"]
            | null
          identity_match_score?: number | null
          image?: string | null
          images?: Json
          indexed_at?: string
          last_checked_at?: string
          last_extracted_at?: string
          last_seen_at?: string
          latitude?: number | null
          length_meters?: number | null
          longitude?: number | null
          manufacturer?: string | null
          marina?: string | null
          model?: string | null
          name?: string | null
          price_minor?: number | null
          price_to_minor?: number | null
          price_unit?: Database["public"]["Enums"]["price_unit"] | null
          region?: string | null
          source_id?: string
          updated_at?: string
          url?: string
          vessel_identity_id?: string | null
          vessel_type?: Database["public"]["Enums"]["vessel_type"] | null
          vessel_type_raw?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "external_vessel_index_vessel_identity_id_fkey"
            columns: ["vessel_identity_id"]
            isOneToOne: false
            referencedRelation: "vessel_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_extracted_listings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          initiative_id: string | null
          profile_id: string
          vessel_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          initiative_id?: string | null
          profile_id: string
          vessel_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          initiative_id?: string | null
          profile_id?: string
          vessel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "favorites_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      initiative_responses: {
        Row: {
          created_at: string
          id: string
          initiative_id: string
          message: string | null
          responder_id: string
          type: Database["public"]["Enums"]["initiative_response_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          initiative_id: string
          message?: string | null
          responder_id: string
          type: Database["public"]["Enums"]["initiative_response_type"]
        }
        Update: {
          created_at?: string
          id?: string
          initiative_id?: string
          message?: string | null
          responder_id?: string
          type?: Database["public"]["Enums"]["initiative_response_type"]
        }
        Relationships: [
          {
            foreignKeyName: "initiative_responses_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiative_responses_responder_id_fkey"
            columns: ["responder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      initiatives: {
        Row: {
          activity_type: string
          author_id: string
          created_at: string
          description: string
          id: string
          latitude: number | null
          location_id: string | null
          longitude: number | null
          region: string
          status: Database["public"]["Enums"]["initiative_status"]
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          activity_type: string
          author_id: string
          created_at?: string
          description: string
          id?: string
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          region: string
          status?: Database["public"]["Enums"]["initiative_status"]
          title: string
          topic: string
          updated_at?: string
        }
        Update: {
          activity_type?: string
          author_id?: string
          created_at?: string
          description?: string
          id?: string
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          region?: string
          status?: Database["public"]["Enums"]["initiative_status"]
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "initiatives_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiatives_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          city: Json
          country: Json
          created_at: string
          id: string
          latitude: number
          longitude: number
          marina: Json | null
          updated_at: string
        }
        Insert: {
          city: Json
          country: Json
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          marina?: Json | null
          updated_at?: string
        }
        Update: {
          city?: Json
          country?: Json
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          marina?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          profile_id: string
          read_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          profile_id: string
          read_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          profile_id?: string
          read_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          booking_id: string
          created_at: string
          currency: string
          external_reference: string | null
          failure_code: string | null
          failure_reason: string | null
          id: string
          payee_id: string
          payer_id: string
          platform_fee_minor: number
          provider: Database["public"]["Enums"]["payment_provider"]
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          booking_id: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          payee_id: string
          payer_id: string
          platform_fee_minor?: number
          provider: Database["public"]["Enums"]["payment_provider"]
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          booking_id?: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          payee_id?: string
          payer_id?: string
          platform_fee_minor?: number
          provider?: Database["public"]["Enums"]["payment_provider"]
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          commission_rate: number
          id: boolean
          internal_first_enabled: boolean
          min_internal_results: number
          reindex_concurrency: number
          updated_at: string
        }
        Insert: {
          commission_rate?: number
          id?: boolean
          internal_first_enabled?: boolean
          min_internal_results?: number
          reindex_concurrency?: number
          updated_at?: string
        }
        Update: {
          commission_rate?: number
          id?: boolean
          internal_first_enabled?: boolean
          min_internal_results?: number
          reindex_concurrency?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_rules: {
        Row: {
          created_at: string
          currency: string
          date_range: unknown
          id: string
          label: string
          price_minor: number
          priority: number
          updated_at: string
          vessel_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          date_range: unknown
          id?: string
          label: string
          price_minor: number
          priority?: number
          updated_at?: string
          vessel_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          date_range?: unknown
          id?: string
          label?: string
          price_minor?: number
          priority?: number
          updated_at?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          currency: string
          full_name: string | null
          id: string
          locale: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          currency?: string
          full_name?: string | null
          id: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          currency?: string
          full_name?: string | null
          id?: string
          locale?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: string
          client_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          vessel_id: string
        }
        Insert: {
          booking_id: string
          client_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          vessel_id: string
        }
        Update: {
          booking_id?: string
          client_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      search_extraction_cache: {
        Row: {
          classification: Json
          content_hash: string
          created_at: string
        }
        Insert: {
          classification: Json
          content_hash: string
          created_at?: string
        }
        Update: {
          classification?: Json
          content_hash?: string
          created_at?: string
        }
        Relationships: []
      }
      search_field_conflicts: {
        Row: {
          detected_at: string
          field: string
          id: string
          listing_id: string
          new_source: Database["public"]["Enums"]["search_field_source"]
          new_value: Json
          previous_source: Database["public"]["Enums"]["search_field_source"]
          previous_value: Json
          resolution: string | null
          resolved_at: string | null
        }
        Insert: {
          detected_at?: string
          field: string
          id?: string
          listing_id: string
          new_source: Database["public"]["Enums"]["search_field_source"]
          new_value: Json
          previous_source: Database["public"]["Enums"]["search_field_source"]
          previous_value: Json
          resolution?: string | null
          resolved_at?: string | null
        }
        Update: {
          detected_at?: string
          field?: string
          id?: string
          listing_id?: string
          new_source?: Database["public"]["Enums"]["search_field_source"]
          new_value?: Json
          previous_source?: Database["public"]["Enums"]["search_field_source"]
          previous_value?: Json
          resolution?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_field_conflicts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_vessel_index"
            referencedColumns: ["id"]
          },
        ]
      }
      search_page_cache: {
        Row: {
          content_hash: string
          etag: string | null
          fetched_at: string
          html: string
          http_status: number
          last_modified: string | null
          updated_at: string
          url: string
        }
        Insert: {
          content_hash: string
          etag?: string | null
          fetched_at?: string
          html: string
          http_status: number
          last_modified?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          content_hash?: string
          etag?: string | null
          fetched_at?: string
          html?: string
          http_status?: number
          last_modified?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      search_runs: {
        Row: {
          ai_calls: number
          candidates_from_index: number
          circuit_breaker_skips: number
          created_at: string
          degraded_reason: string | null
          duplicates_detected: number
          errors: Json
          execution_ms: number | null
          external_phase: Database["public"]["Enums"]["search_external_phase"]
          external_results: number
          generated_queries: Json
          id: string
          internal_first_short_circuit: boolean
          internal_results: number
          interpretation_mode: string
          interpreted_criteria: Json
          live_verifications: number
          locale: string
          offers_extracted: number
          offers_normalized: number
          original_query: string
          pages_from_index: number
          pages_rejected: number
          pages_revalidated_unchanged: number
          pages_visited: number
          request_version: number
          sources_skipped_by_coverage: number
          sources_visited: number
          user_id: string | null
          verification_failures: number
        }
        Insert: {
          ai_calls?: number
          candidates_from_index?: number
          circuit_breaker_skips?: number
          created_at?: string
          degraded_reason?: string | null
          duplicates_detected?: number
          errors?: Json
          execution_ms?: number | null
          external_phase?: Database["public"]["Enums"]["search_external_phase"]
          external_results?: number
          generated_queries?: Json
          id?: string
          internal_first_short_circuit?: boolean
          internal_results?: number
          interpretation_mode?: string
          interpreted_criteria?: Json
          live_verifications?: number
          locale: string
          offers_extracted?: number
          offers_normalized?: number
          original_query: string
          pages_from_index?: number
          pages_rejected?: number
          pages_revalidated_unchanged?: number
          pages_visited?: number
          request_version?: number
          sources_skipped_by_coverage?: number
          sources_visited?: number
          user_id?: string | null
          verification_failures?: number
        }
        Update: {
          ai_calls?: number
          candidates_from_index?: number
          circuit_breaker_skips?: number
          created_at?: string
          degraded_reason?: string | null
          duplicates_detected?: number
          errors?: Json
          execution_ms?: number | null
          external_phase?: Database["public"]["Enums"]["search_external_phase"]
          external_results?: number
          generated_queries?: Json
          id?: string
          internal_first_short_circuit?: boolean
          internal_results?: number
          interpretation_mode?: string
          interpreted_criteria?: Json
          live_verifications?: number
          locale?: string
          offers_extracted?: number
          offers_normalized?: number
          original_query?: string
          pages_from_index?: number
          pages_rejected?: number
          pages_revalidated_unchanged?: number
          pages_visited?: number
          request_version?: number
          sources_skipped_by_coverage?: number
          sources_visited?: number
          user_id?: string | null
          verification_failures?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      search_source_breadcrumbs: {
        Row: {
          created_at: string
          id: string
          label: string
          last_seen_at: string
          normalized_label: string
          normalized_parent_label: string
          source_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          last_seen_at?: string
          normalized_label: string
          normalized_parent_label?: string
          source_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_seen_at?: string
          normalized_label?: string
          normalized_parent_label?: string
          source_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_source_breadcrumbs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      search_source_coverage: {
        Row: {
          country: string | null
          created_at: string
          destination: string | null
          id: string
          latitude: number | null
          longitude: number | null
          radius_km: number | null
          region: string | null
          source_id: string
          worldwide: boolean
        }
        Insert: {
          country?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          radius_km?: number | null
          region?: string | null
          source_id: string
          worldwide?: boolean
        }
        Update: {
          country?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          radius_km?: number | null
          region?: string | null
          source_id?: string
          worldwide?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "search_source_coverage_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      search_source_crawl_rules: {
        Row: {
          classification: Database["public"]["Enums"]["search_url_classification"]
          created_at: string
          enabled: boolean
          id: string
          pattern: string
          pattern_type: Database["public"]["Enums"]["search_crawl_rule_pattern_type"]
          priority: number
          source_id: string
          updated_at: string
        }
        Insert: {
          classification: Database["public"]["Enums"]["search_url_classification"]
          created_at?: string
          enabled?: boolean
          id?: string
          pattern: string
          pattern_type?: Database["public"]["Enums"]["search_crawl_rule_pattern_type"]
          priority?: number
          source_id: string
          updated_at?: string
        }
        Update: {
          classification?: Database["public"]["Enums"]["search_url_classification"]
          created_at?: string
          enabled?: boolean
          id?: string
          pattern?: string
          pattern_type?: Database["public"]["Enums"]["search_crawl_rule_pattern_type"]
          priority?: number
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_source_crawl_rules_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      search_source_health: {
        Row: {
          consecutive_failures: number
          last_error: string | null
          last_failure_at: string | null
          last_success_at: string | null
          opened_at: string | null
          source_id: string
          state: Database["public"]["Enums"]["search_circuit_state"]
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          last_error?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          opened_at?: string | null
          source_id: string
          state?: Database["public"]["Enums"]["search_circuit_state"]
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          last_error?: string | null
          last_failure_at?: string | null
          last_success_at?: string | null
          opened_at?: string | null
          source_id?: string
          state?: Database["public"]["Enums"]["search_circuit_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_source_health_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      search_source_policies: {
        Row: {
          access_policy: Json
          attribution_policy: Json
          cache_policy: Json
          rate_limit_policy: Json
          retention_policy: Json
          source_id: string
          updated_at: string
        }
        Insert: {
          access_policy?: Json
          attribution_policy?: Json
          cache_policy?: Json
          rate_limit_policy?: Json
          retention_policy?: Json
          source_id: string
          updated_at?: string
        }
        Update: {
          access_policy?: Json
          attribution_policy?: Json
          cache_policy?: Json
          rate_limit_policy?: Json
          retention_policy?: Json
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_source_policies_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      search_source_urls: {
        Row: {
          classification: Database["public"]["Enums"]["search_url_classification"]
          content_hash: string | null
          crawl_status: Database["public"]["Enums"]["search_url_crawl_status"]
          created_at: string
          discovered_at: string
          http_status: number | null
          id: string
          last_ai_processed_at: string | null
          last_fetched_at: string | null
          last_seen_at: string
          priority: number
          selected: boolean
          selection_override: boolean | null
          sitemap_lastmod: string | null
          source_id: string
          source_sitemap: string | null
          updated_at: string
          url: string
        }
        Insert: {
          classification?: Database["public"]["Enums"]["search_url_classification"]
          content_hash?: string | null
          crawl_status?: Database["public"]["Enums"]["search_url_crawl_status"]
          created_at?: string
          discovered_at?: string
          http_status?: number | null
          id?: string
          last_ai_processed_at?: string | null
          last_fetched_at?: string | null
          last_seen_at?: string
          priority?: number
          selected?: boolean
          selection_override?: boolean | null
          sitemap_lastmod?: string | null
          source_id: string
          source_sitemap?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          classification?: Database["public"]["Enums"]["search_url_classification"]
          content_hash?: string | null
          crawl_status?: Database["public"]["Enums"]["search_url_crawl_status"]
          created_at?: string
          discovered_at?: string
          http_status?: number | null
          id?: string
          last_ai_processed_at?: string | null
          last_fetched_at?: string | null
          last_seen_at?: string
          priority?: number
          selected?: boolean
          selection_override?: boolean | null
          sitemap_lastmod?: string | null
          source_id?: string
          source_sitemap?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_source_urls_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      search_sources: {
        Row: {
          access_strategy: Database["public"]["Enums"]["search_access_strategy"]
          auto_select_classifications: Database["public"]["Enums"]["search_url_classification"][]
          base_url: string
          can_availability: boolean
          can_contact: boolean
          can_details: boolean
          can_pricing: boolean
          can_search: boolean
          contact_capability:
            | Database["public"]["Enums"]["search_contact_capability"]
            | null
          created_at: string
          detailed_logging: boolean
          domain: string
          enabled: boolean
          fallback_strategies: Database["public"]["Enums"]["search_access_strategy"][]
          id: string
          image_domains: string[]
          last_checked_at: string | null
          name: string
          needs_reanalysis: boolean
          notes: string | null
          priority: number
          processing_type: Database["public"]["Enums"]["search_processing_type"]
          reanalysis_sample_size: number | null
          reanalysis_success_count: number | null
          reindex_cancel_requested: boolean
          reindex_finished_at: string | null
          reindex_processed: number | null
          reindex_started_at: string | null
          reindex_total: number | null
          reliability_score: number | null
          robots_allows: boolean | null
          selector_config: Json | null
          source_type: Database["public"]["Enums"]["search_source_type"]
          status: Database["public"]["Enums"]["search_source_status"]
          structure_checked_at: string | null
          supports_dates: boolean
          supports_guests: boolean
          supports_location: boolean
          supports_price: boolean
          updated_at: string
        }
        Insert: {
          access_strategy: Database["public"]["Enums"]["search_access_strategy"]
          auto_select_classifications?: Database["public"]["Enums"]["search_url_classification"][]
          base_url: string
          can_availability?: boolean
          can_contact?: boolean
          can_details?: boolean
          can_pricing?: boolean
          can_search?: boolean
          contact_capability?:
            | Database["public"]["Enums"]["search_contact_capability"]
            | null
          created_at?: string
          detailed_logging?: boolean
          domain: string
          enabled?: boolean
          fallback_strategies?: Database["public"]["Enums"]["search_access_strategy"][]
          id?: string
          image_domains?: string[]
          last_checked_at?: string | null
          name: string
          needs_reanalysis?: boolean
          notes?: string | null
          priority?: number
          processing_type?: Database["public"]["Enums"]["search_processing_type"]
          reanalysis_sample_size?: number | null
          reanalysis_success_count?: number | null
          reindex_cancel_requested?: boolean
          reindex_finished_at?: string | null
          reindex_processed?: number | null
          reindex_started_at?: string | null
          reindex_total?: number | null
          reliability_score?: number | null
          robots_allows?: boolean | null
          selector_config?: Json | null
          source_type?: Database["public"]["Enums"]["search_source_type"]
          status?: Database["public"]["Enums"]["search_source_status"]
          structure_checked_at?: string | null
          supports_dates?: boolean
          supports_guests?: boolean
          supports_location?: boolean
          supports_price?: boolean
          updated_at?: string
        }
        Update: {
          access_strategy?: Database["public"]["Enums"]["search_access_strategy"]
          auto_select_classifications?: Database["public"]["Enums"]["search_url_classification"][]
          base_url?: string
          can_availability?: boolean
          can_contact?: boolean
          can_details?: boolean
          can_pricing?: boolean
          can_search?: boolean
          contact_capability?:
            | Database["public"]["Enums"]["search_contact_capability"]
            | null
          created_at?: string
          detailed_logging?: boolean
          domain?: string
          enabled?: boolean
          fallback_strategies?: Database["public"]["Enums"]["search_access_strategy"][]
          id?: string
          image_domains?: string[]
          last_checked_at?: string | null
          name?: string
          needs_reanalysis?: boolean
          notes?: string | null
          priority?: number
          processing_type?: Database["public"]["Enums"]["search_processing_type"]
          reanalysis_sample_size?: number | null
          reanalysis_success_count?: number | null
          reindex_cancel_requested?: boolean
          reindex_finished_at?: string | null
          reindex_processed?: number | null
          reindex_started_at?: string | null
          reindex_total?: number | null
          reliability_score?: number | null
          robots_allows?: boolean | null
          selector_config?: Json | null
          source_type?: Database["public"]["Enums"]["search_source_type"]
          status?: Database["public"]["Enums"]["search_source_status"]
          structure_checked_at?: string | null
          supports_dates?: boolean
          supports_guests?: boolean
          supports_location?: boolean
          supports_price?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      vessel_amenities: {
        Row: {
          amenity_id: string
          vessel_id: string
        }
        Insert: {
          amenity_id: string
          vessel_id: string
        }
        Update: {
          amenity_id?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vessel_amenities_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_amenities_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_identities: {
        Row: {
          canonical_name: string | null
          city: string | null
          created_at: string
          id: string
          length_meters: number | null
          manufacturer: string | null
          marina: string | null
          model: string | null
          offer_count: number
          representative_image: string | null
          updated_at: string
          vessel_type: Database["public"]["Enums"]["vessel_type"] | null
          year: number | null
        }
        Insert: {
          canonical_name?: string | null
          city?: string | null
          created_at?: string
          id?: string
          length_meters?: number | null
          manufacturer?: string | null
          marina?: string | null
          model?: string | null
          offer_count?: number
          representative_image?: string | null
          updated_at?: string
          vessel_type?: Database["public"]["Enums"]["vessel_type"] | null
          year?: number | null
        }
        Update: {
          canonical_name?: string | null
          city?: string | null
          created_at?: string
          id?: string
          length_meters?: number | null
          manufacturer?: string | null
          marina?: string | null
          model?: string | null
          offer_count?: number
          representative_image?: string | null
          updated_at?: string
          vessel_type?: Database["public"]["Enums"]["vessel_type"] | null
          year?: number | null
        }
        Relationships: []
      }
      vessel_images: {
        Row: {
          alt_text: Json
          created_at: string
          id: string
          sort_order: number
          url: string
          vessel_id: string
        }
        Insert: {
          alt_text?: Json
          created_at?: string
          id?: string
          sort_order?: number
          url: string
          vessel_id: string
        }
        Update: {
          alt_text?: Json
          created_at?: string
          id?: string
          sort_order?: number
          url?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vessel_images_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_type_aliases: {
        Row: {
          alias: string
          confidence: number
          created_at: string
          id: string
          source_id: string | null
          updated_at: string
          vessel_type: Database["public"]["Enums"]["vessel_type"]
        }
        Insert: {
          alias: string
          confidence?: number
          created_at?: string
          id?: string
          source_id?: string | null
          updated_at?: string
          vessel_type: Database["public"]["Enums"]["vessel_type"]
        }
        Update: {
          alias?: string
          confidence?: number
          created_at?: string
          id?: string
          source_id?: string | null
          updated_at?: string
          vessel_type?: Database["public"]["Enums"]["vessel_type"]
        }
        Relationships: [
          {
            foreignKeyName: "vessel_type_aliases_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "search_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      vessels: {
        Row: {
          base_price_minor: number
          cabins: number
          created_at: string
          currency: string
          description: Json
          guests_capacity: number
          id: string
          latitude: number | null
          length_meters: number
          location_id: string
          longitude: number | null
          name: string
          owner_id: string
          rating_avg: number
          rating_count: number
          slug: string
          status: Database["public"]["Enums"]["vessel_status"]
          type: Database["public"]["Enums"]["vessel_type"]
          updated_at: string
          year_built: number | null
        }
        Insert: {
          base_price_minor: number
          cabins?: number
          created_at?: string
          currency?: string
          description?: Json
          guests_capacity: number
          id?: string
          latitude?: number | null
          length_meters: number
          location_id: string
          longitude?: number | null
          name: string
          owner_id: string
          rating_avg?: number
          rating_count?: number
          slug: string
          status?: Database["public"]["Enums"]["vessel_status"]
          type: Database["public"]["Enums"]["vessel_type"]
          updated_at?: string
          year_built?: number | null
        }
        Update: {
          base_price_minor?: number
          cabins?: number
          created_at?: string
          currency?: string
          description?: Json
          guests_capacity?: number
          id?: string
          latitude?: number | null
          length_meters?: number
          location_id?: string
          longitude?: number | null
          name?: string
          owner_id?: string
          rating_avg?: number
          rating_count?: number
          slug?: string
          status?: Database["public"]["Enums"]["vessel_status"]
          type?: Database["public"]["Enums"]["vessel_type"]
          updated_at?: string
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vessels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_vessel_booked_ranges: {
        Args: { p_vessel_id: string }
        Returns: unknown[]
      }
      get_vessels_booked_ranges: {
        Args: { p_vessel_ids: string[] }
        Returns: {
          date_range: unknown
          vessel_id: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_conversation_participant: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
    }
    Enums: {
      booking_status:
        | "pending"
        | "confirmed"
        | "paid"
        | "cancelled"
        | "completed"
      initiative_response_type:
        | "participation"
        | "collaboration"
        | "info_request"
      initiative_status: "open" | "closed"
      intent_status:
        | "DRAFT"
        | "CONFIRMED"
        | "SENT"
        | "ANSWERED"
        | "FAILED"
        | "CANCELLED"
      intent_type: "CONTACT_REQUEST" | "BOOKING_REQUEST" | "INFO_REQUEST"
      payment_provider: "stripe" | "bank_transfer"
      payment_status:
        | "pending"
        | "succeeded"
        | "failed"
        | "refunded"
        | "cancelled"
      price_unit: "HOUR" | "DAY" | "WEEK" | "MONTH" | "TRIP"
      search_access_strategy:
        | "API"
        | "GRAPHQL"
        | "STRUCTURED_DATA"
        | "SEARCH_URL"
        | "WEB_PARSER"
        | "AI_EXTRACTION"
      search_circuit_state: "CLOSED" | "OPEN" | "HALF_OPEN"
      search_contact_capability:
        | "EMAIL"
        | "PROVIDER_API"
        | "CONTACT_FORM"
        | "EXTERNAL_BOOKING_URL"
        | "PLATFORM_MESSAGE"
        | "REDIRECT_ONLY"
      search_crawl_rule_pattern_type: "PREFIX" | "REGEX"
      search_external_phase: "SKIPPED" | "PENDING" | "COMPLETE" | "FAILED"
      search_field_source:
        | "SELECTOR"
        | "JSON_LD"
        | "AI"
        | "MANUAL"
        | "BREADCRUMB"
      search_processing_type:
        | "API"
        | "HTML"
        | "STRUCTURED_DATA"
        | "AI_EXTRACTION"
        | "HYBRID"
      search_source_status: "draft" | "needs_review" | "active" | "rejected"
      search_source_type: "WEBSITE" | "API"
      search_url_classification: "HIGH" | "MEDIUM" | "LOW" | "SKIP"
      search_url_crawl_status: "PENDING" | "FETCHED" | "FAILED" | "SKIPPED"
      user_role: "client" | "owner" | "admin"
      vessel_identity_match_method: "SEED" | "DETERMINISTIC" | "AI"
      vessel_status: "draft" | "published" | "archived"
      vessel_type:
        | "MOTOR_YACHT"
        | "SAILING_YACHT"
        | "CATAMARAN"
        | "TRIMARAN"
        | "SUPERYACHT"
        | "EXPEDITION_YACHT"
        | "RESEARCH_VESSEL"
        | "MOTOR_BOAT"
        | "SAILING_BOAT"
        | "OTHER"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booking_status: [
        "pending",
        "confirmed",
        "paid",
        "cancelled",
        "completed",
      ],
      initiative_response_type: [
        "participation",
        "collaboration",
        "info_request",
      ],
      initiative_status: ["open", "closed"],
      intent_status: [
        "DRAFT",
        "CONFIRMED",
        "SENT",
        "ANSWERED",
        "FAILED",
        "CANCELLED",
      ],
      intent_type: ["CONTACT_REQUEST", "BOOKING_REQUEST", "INFO_REQUEST"],
      payment_provider: ["stripe", "bank_transfer"],
      payment_status: [
        "pending",
        "succeeded",
        "failed",
        "refunded",
        "cancelled",
      ],
      price_unit: ["HOUR", "DAY", "WEEK", "MONTH", "TRIP"],
      search_access_strategy: [
        "API",
        "GRAPHQL",
        "STRUCTURED_DATA",
        "SEARCH_URL",
        "WEB_PARSER",
        "AI_EXTRACTION",
      ],
      search_circuit_state: ["CLOSED", "OPEN", "HALF_OPEN"],
      search_contact_capability: [
        "EMAIL",
        "PROVIDER_API",
        "CONTACT_FORM",
        "EXTERNAL_BOOKING_URL",
        "PLATFORM_MESSAGE",
        "REDIRECT_ONLY",
      ],
      search_crawl_rule_pattern_type: ["PREFIX", "REGEX"],
      search_external_phase: ["SKIPPED", "PENDING", "COMPLETE", "FAILED"],
      search_field_source: [
        "SELECTOR",
        "JSON_LD",
        "AI",
        "MANUAL",
        "BREADCRUMB",
      ],
      search_processing_type: [
        "API",
        "HTML",
        "STRUCTURED_DATA",
        "AI_EXTRACTION",
        "HYBRID",
      ],
      search_source_status: ["draft", "needs_review", "active", "rejected"],
      search_source_type: ["WEBSITE", "API"],
      search_url_classification: ["HIGH", "MEDIUM", "LOW", "SKIP"],
      search_url_crawl_status: ["PENDING", "FETCHED", "FAILED", "SKIPPED"],
      user_role: ["client", "owner", "admin"],
      vessel_identity_match_method: ["SEED", "DETERMINISTIC", "AI"],
      vessel_status: ["draft", "published", "archived"],
      vessel_type: [
        "MOTOR_YACHT",
        "SAILING_YACHT",
        "CATAMARAN",
        "TRIMARAN",
        "SUPERYACHT",
        "EXPEDITION_YACHT",
        "RESEARCH_VESSEL",
        "MOTOR_BOAT",
        "SAILING_BOAT",
        "OTHER",
      ],
    },
  },
} as const


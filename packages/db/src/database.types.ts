export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      action_executions: {
        Row: {
          approval_id: string;
          attempt: number;
          error: string | null;
          external_ids: NonNullable<Json>;
          finished_at: string | null;
          id: string;
          org_id: string;
          result_redacted: Json | null;
          started_at: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          approval_id: string;
          attempt?: number;
          error?: string | null;
          external_ids?: NonNullable<Json>;
          finished_at?: string | null;
          id?: string;
          org_id: string;
          result_redacted?: Json | null;
          started_at?: string;
          status?: string;
        };
        Update: {
          approval_id?: string;
          attempt?: number;
          error?: string | null;
          external_ids?: NonNullable<Json>;
          finished_at?: string | null;
          id?: string;
          org_id?: string;
          result_redacted?: Json | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'action_executions_approval_id_org_id_fkey';
            columns: ['approval_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'approvals';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'action_executions_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_runs: {
        Row: {
          cache_read_tokens: number;
          cache_write_tokens: number;
          cost_usd: number;
          ended_at: string | null;
          error: string | null;
          id: string;
          input_tokens: number;
          model: string | null;
          org_id: string;
          output_tokens: number;
          prompt_hashes: NonNullable<Json>;
          run_number: number;
          session_id: string | null;
          started_at: string;
          status: string;
          tainted: boolean;
          task_id: string;
          trigger: string;
          usage_by_agent: NonNullable<Json>;
          usage_recorded: boolean;
        };
        ComputedFields: never;
        Insert: {
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd?: number;
          ended_at?: string | null;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          model?: string | null;
          org_id: string;
          output_tokens?: number;
          prompt_hashes?: NonNullable<Json>;
          run_number: number;
          session_id?: string | null;
          started_at?: string;
          status?: string;
          tainted?: boolean;
          task_id: string;
          trigger: string;
          usage_by_agent?: NonNullable<Json>;
          usage_recorded?: boolean;
        };
        Update: {
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd?: number;
          ended_at?: string | null;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          model?: string | null;
          org_id?: string;
          output_tokens?: number;
          prompt_hashes?: NonNullable<Json>;
          run_number?: number;
          session_id?: string | null;
          started_at?: string;
          status?: string;
          tainted?: boolean;
          task_id?: string;
          trigger?: string;
          usage_by_agent?: NonNullable<Json>;
          usage_recorded?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_runs_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_runs_task_id_org_id_fkey';
            columns: ['task_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id', 'org_id'];
          },
        ];
      };
      agent_steps: {
        Row: {
          agent: string;
          created_at: string;
          duration_ms: number | null;
          id: number;
          input_redacted: Json | null;
          kind: string;
          org_id: string;
          output_redacted: Json | null;
          run_id: string;
          status: string | null;
          tool_name: string | null;
          tool_use_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          agent: string;
          created_at?: string;
          duration_ms?: number | null;
          id?: never;
          input_redacted?: Json | null;
          kind: string;
          org_id: string;
          output_redacted?: Json | null;
          run_id: string;
          status?: string | null;
          tool_name?: string | null;
          tool_use_id?: string | null;
        };
        Update: {
          agent?: string;
          created_at?: string;
          duration_ms?: number | null;
          id?: never;
          input_redacted?: Json | null;
          kind?: string;
          org_id?: string;
          output_redacted?: Json | null;
          run_id?: string;
          status?: string | null;
          tool_name?: string | null;
          tool_use_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_steps_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_steps_run_id_org_id_fkey';
            columns: ['run_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'agent_runs';
            referencedColumns: ['id', 'org_id'];
          },
        ];
      };
      approvals: {
        Row: {
          action_type: string;
          autonomy_level: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_channel: string | null;
          decision_note: string | null;
          edited_payload: Json | null;
          expires_at: string;
          id: string;
          idempotency_key: string;
          org_id: string;
          payload: NonNullable<Json>;
          preview: NonNullable<Json>;
          reason: string | null;
          requested_by_agent: string;
          risk_level: string;
          run_id: string | null;
          status: string;
          task_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          action_type: string;
          autonomy_level: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_channel?: string | null;
          decision_note?: string | null;
          edited_payload?: Json | null;
          expires_at?: string;
          id?: string;
          idempotency_key: string;
          org_id: string;
          payload: NonNullable<Json>;
          preview?: NonNullable<Json>;
          reason?: string | null;
          requested_by_agent: string;
          risk_level?: string;
          run_id?: string | null;
          status?: string;
          task_id: string;
          updated_at?: string;
        };
        Update: {
          action_type?: string;
          autonomy_level?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_channel?: string | null;
          decision_note?: string | null;
          edited_payload?: Json | null;
          expires_at?: string;
          id?: string;
          idempotency_key?: string;
          org_id?: string;
          payload?: NonNullable<Json>;
          preview?: NonNullable<Json>;
          reason?: string | null;
          requested_by_agent?: string;
          risk_level?: string;
          run_id?: string | null;
          status?: string;
          task_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'approvals_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'approvals_run_fk';
            columns: ['run_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'agent_runs';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'approvals_task_id_org_id_fkey';
            columns: ['task_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id', 'org_id'];
          },
        ];
      };
      artifacts: {
        Row: {
          created_at: string;
          created_by_agent: string;
          data: NonNullable<Json>;
          id: string;
          kind: string;
          org_id: string;
          task_id: string;
          title: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by_agent: string;
          data: NonNullable<Json>;
          id?: string;
          kind: string;
          org_id: string;
          task_id: string;
          title: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by_agent?: string;
          data?: NonNullable<Json>;
          id?: string;
          kind?: string;
          org_id?: string;
          task_id?: string;
          title?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'artifacts_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'artifacts_task_id_org_id_fkey';
            columns: ['task_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id', 'org_id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string;
          actor_type: string;
          cost_usd: number | null;
          created_at: string;
          id: number;
          org_id: string;
          payload_redacted: Json | null;
          reason: string | null;
          run_id: string | null;
          target: string | null;
          task_id: string | null;
          tokens: number | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id: string;
          actor_type: string;
          cost_usd?: number | null;
          created_at?: string;
          id?: never;
          org_id: string;
          payload_redacted?: Json | null;
          reason?: string | null;
          run_id?: string | null;
          target?: string | null;
          task_id?: string | null;
          tokens?: number | null;
        };
        Update: {
          action?: string;
          actor_id?: string;
          actor_type?: string;
          cost_usd?: number | null;
          created_at?: string;
          id?: never;
          org_id?: string;
          payload_redacted?: Json | null;
          reason?: string | null;
          run_id?: string | null;
          target?: string | null;
          task_id?: string | null;
          tokens?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      autonomy_policies: {
        Row: {
          action_type: string;
          level: string;
          limits: NonNullable<Json>;
          org_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          action_type: string;
          level: string;
          limits?: NonNullable<Json>;
          org_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          action_type?: string;
          level?: string;
          limits?: NonNullable<Json>;
          org_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'autonomy_policies_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      channels: {
        Row: {
          address_e164: string;
          created_at: string;
          id: string;
          kind: string;
          last_inbound_at: string | null;
          org_id: string;
          quiet_hours: Json | null;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          address_e164: string;
          created_at?: string;
          id?: string;
          kind?: string;
          last_inbound_at?: string | null;
          org_id: string;
          quiet_hours?: Json | null;
          updated_at?: string;
          user_id: string;
          verified_at?: string | null;
        };
        Update: {
          address_e164?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          last_inbound_at?: string | null;
          org_id?: string;
          quiet_hours?: Json | null;
          updated_at?: string;
          user_id?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'channels_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'channels_org_id_user_id_fkey';
            columns: ['org_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'memberships';
            referencedColumns: ['org_id', 'user_id'];
          },
        ];
      };
      company_profiles: {
        Row: {
          business_hours: string | null;
          description: string | null;
          do_not_say: string[];
          instagram_handle: string | null;
          org_id: string;
          regions: string[];
          regulated_sector: string | null;
          segment: string | null;
          special_ad_categories: string[];
          tone_of_voice: string | null;
          updated_at: string;
          website_url: string | null;
        };
        ComputedFields: never;
        Insert: {
          business_hours?: string | null;
          description?: string | null;
          do_not_say?: string[];
          instagram_handle?: string | null;
          org_id: string;
          regions?: string[];
          regulated_sector?: string | null;
          segment?: string | null;
          special_ad_categories?: string[];
          tone_of_voice?: string | null;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          business_hours?: string | null;
          description?: string | null;
          do_not_say?: string[];
          instagram_handle?: string | null;
          org_id?: string;
          regions?: string[];
          regulated_sector?: string | null;
          segment?: string | null;
          special_ad_categories?: string[];
          tone_of_voice?: string | null;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'company_profiles_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      connections: {
        Row: {
          created_at: string;
          expires_at: string | null;
          external_ids: NonNullable<Json>;
          id: string;
          label: string;
          last_error: string | null;
          org_id: string;
          provider: string;
          scopes: string[];
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          external_ids?: NonNullable<Json>;
          id?: string;
          label?: string;
          last_error?: string | null;
          org_id: string;
          provider: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          external_ids?: NonNullable<Json>;
          id?: string;
          label?: string;
          last_error?: string | null;
          org_id?: string;
          provider?: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'connections_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      conversations: {
        Row: {
          channel: string;
          created_at: string;
          employee_id: string;
          id: string;
          org_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel?: string;
          created_at?: string;
          employee_id: string;
          id?: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          employee_id?: string;
          id?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_employee_id_org_id_fkey';
            columns: ['employee_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'conversations_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      employees: {
        Row: {
          created_at: string;
          display_name: string;
          hired_at: string;
          id: string;
          org_id: string;
          role_version_id: string;
          settings: NonNullable<Json>;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name: string;
          hired_at?: string;
          id?: string;
          org_id: string;
          role_version_id: string;
          settings?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          hired_at?: string;
          id?: string;
          org_id?: string;
          role_version_id?: string;
          settings?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'employees_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employees_role_version_id_fkey';
            columns: ['role_version_id'];
            isOneToOne: false;
            referencedRelation: 'role_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          content_tsv: unknown;
          created_at: string;
          document_id: string;
          embedding: string | null;
          id: string;
          metadata: NonNullable<Json>;
          org_id: string;
        };
        ComputedFields: never;
        Insert: {
          chunk_index: number;
          content: string;
          content_tsv?: never;
          created_at?: string;
          document_id: string;
          embedding?: string | null;
          id?: string;
          metadata?: NonNullable<Json>;
          org_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          content_tsv?: never;
          created_at?: string;
          document_id?: string;
          embedding?: string | null;
          id?: string;
          metadata?: NonNullable<Json>;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_chunks_document_id_org_id_fkey';
            columns: ['document_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_documents';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'knowledge_chunks_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_documents: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          org_id: string;
          source: string;
          status: string;
          storage_path: string | null;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          org_id: string;
          source: string;
          status?: string;
          storage_path?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          org_id?: string;
          source?: string;
          status?: string;
          storage_path?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_documents_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          org_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memberships_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          attachments: NonNullable<Json>;
          author: string;
          content: string;
          conversation_id: string;
          created_at: string;
          delivery_status: string;
          id: string;
          org_id: string;
          task_id: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          attachments?: NonNullable<Json>;
          author: string;
          content: string;
          conversation_id: string;
          created_at?: string;
          delivery_status?: string;
          id?: string;
          org_id: string;
          task_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          attachments?: NonNullable<Json>;
          author?: string;
          content?: string;
          conversation_id?: string;
          created_at?: string;
          delivery_status?: string;
          id?: string;
          org_id?: string;
          task_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_org_id_fkey';
            columns: ['conversation_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'messages_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_task_id_org_id_fkey';
            columns: ['task_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id', 'org_id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          currency: string;
          daily_budget_cap_cents: number;
          id: string;
          monthly_cost_cap_usd: number | null;
          name: string;
          slug: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          currency?: string;
          daily_budget_cap_cents?: number;
          id?: string;
          monthly_cost_cap_usd?: number | null;
          name: string;
          slug: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          daily_budget_cap_cents?: number;
          id?: string;
          monthly_cost_cap_usd?: number | null;
          name?: string;
          slug?: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          active: boolean;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          org_id: string;
          price_cents: number | null;
          price_is_public: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          org_id: string;
          price_cents?: number | null;
          price_is_public?: boolean;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          org_id?: string;
          price_cents?: number | null;
          price_is_public?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'products_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      role_versions: {
        Row: {
          config: NonNullable<Json>;
          config_sha256: string;
          id: string;
          published_at: string;
          role_key: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          config: NonNullable<Json>;
          config_sha256: string;
          id?: string;
          published_at?: string;
          role_key: string;
          version: number;
        };
        Update: {
          config?: NonNullable<Json>;
          config_sha256?: string;
          id?: string;
          published_at?: string;
          role_key?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'role_versions_role_key_fkey';
            columns: ['role_key'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['key'];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          description: string;
          display_name: string;
          key: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description: string;
          display_name: string;
          key: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          display_name?: string;
          key?: string;
        };
        Relationships: [];
      };
      routines: {
        Row: {
          created_at: string;
          cron: string;
          employee_id: string;
          enabled: boolean;
          id: string;
          in_flight: boolean;
          job_type: string | null;
          kind: string;
          last_error: string | null;
          last_run_at: string | null;
          next_run_at: string | null;
          org_id: string;
          routine_key: string;
          task_template: NonNullable<Json>;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          cron: string;
          employee_id: string;
          enabled?: boolean;
          id?: string;
          in_flight?: boolean;
          job_type?: string | null;
          kind: string;
          last_error?: string | null;
          last_run_at?: string | null;
          next_run_at?: string | null;
          org_id: string;
          routine_key: string;
          task_template?: NonNullable<Json>;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          cron?: string;
          employee_id?: string;
          enabled?: boolean;
          id?: string;
          in_flight?: boolean;
          job_type?: string | null;
          kind?: string;
          last_error?: string | null;
          last_run_at?: string | null;
          next_run_at?: string | null;
          org_id?: string;
          routine_key?: string;
          task_template?: NonNullable<Json>;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'routines_employee_id_org_id_fkey';
            columns: ['employee_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'routines_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      tasks: {
        Row: {
          assigned_agent: string | null;
          attempts: number;
          conversation_id: string | null;
          created_at: string;
          created_by: string | null;
          employee_id: string;
          error: string | null;
          finished_at: string | null;
          id: string;
          input: NonNullable<Json>;
          max_attempts: number;
          org_id: string;
          parent_id: string | null;
          result: Json | null;
          routine_id: string | null;
          source: string;
          started_at: string | null;
          status: string;
          tainted: boolean;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_agent?: string | null;
          attempts?: number;
          conversation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          employee_id: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          input?: NonNullable<Json>;
          max_attempts?: number;
          org_id: string;
          parent_id?: string | null;
          result?: Json | null;
          routine_id?: string | null;
          source: string;
          started_at?: string | null;
          status?: string;
          tainted?: boolean;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_agent?: string | null;
          attempts?: number;
          conversation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          employee_id?: string;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          input?: NonNullable<Json>;
          max_attempts?: number;
          org_id?: string;
          parent_id?: string | null;
          result?: Json | null;
          routine_id?: string | null;
          source?: string;
          started_at?: string | null;
          status?: string;
          tainted?: boolean;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_conversation_id_org_id_fkey';
            columns: ['conversation_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'tasks_employee_id_org_id_fkey';
            columns: ['employee_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'tasks_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_parent_id_org_id_fkey';
            columns: ['parent_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'tasks_routine_id_org_id_fkey';
            columns: ['routine_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'routines';
            referencedColumns: ['id', 'org_id'];
          },
        ];
      };
      usage_ledger: {
        Row: {
          cache_read_tokens: number;
          cache_write_tokens: number;
          cost_usd: number;
          employee_id: string;
          input_tokens: number;
          org_id: string;
          output_tokens: number;
          period: string;
          runs: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd?: number;
          employee_id: string;
          input_tokens?: number;
          org_id: string;
          output_tokens?: number;
          period: string;
          runs?: number;
          updated_at?: string;
        };
        Update: {
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd?: number;
          employee_id?: string;
          input_tokens?: number;
          org_id?: string;
          output_tokens?: number;
          period?: string;
          runs?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_ledger_employee_id_org_id_fkey';
            columns: ['employee_id', 'org_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id', 'org_id'];
          },
          {
            foreignKeyName: 'usage_ledger_org_id_fkey';
            columns: ['org_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_purge_organization: {
        Args: { p_confirm_slug: string; p_org_id: string };
        Returns: undefined;
      };
      claim_task: {
        Args: { p_task_id: string };
        Returns: {
          attempts: number;
          max_attempts: number;
          org_id: string;
          run_id: string;
          run_number: number;
          run_trigger: string;
          task_id: string;
        }[];
      };
      connection_secret_get: { Args: { p_connection_id: string }; Returns: string };
      connection_secret_set: {
        Args: { p_connection_id: string; p_secret: string };
        Returns: undefined;
      };
      create_task: {
        Args: { p_employee_id: string; p_input?: Json; p_title: string };
        Returns: string;
      };
      decide_approval: {
        Args: {
          p_approval_id: string;
          p_channel?: string;
          p_decision: string;
          p_edited_payload?: Json;
          p_note?: string;
        };
        Returns: string;
      };
      hire_employee: {
        Args: {
          p_display_name: string;
          p_org_id: string;
          p_role_key: string;
          p_role_version: number;
        };
        Returns: string;
      };
      queue_archive: { Args: { p_msg_id: number; p_queue: string }; Returns: boolean };
      queue_read: {
        Args: { p_quantity: number; p_queue: string; p_visibility_seconds: number };
        Returns: {
          enqueued_at: string;
          message: Json;
          msg_id: number;
          read_ct: number;
          vt: string;
        }[];
      };
      queue_send: {
        Args: { p_delay_seconds?: number; p_message: Json; p_queue: string };
        Returns: number;
      };
      queue_set_visibility: {
        Args: { p_msg_id: number; p_queue: string; p_visibility_seconds: number };
        Returns: undefined;
      };
      record_run_usage: { Args: { p_run_id: string }; Returns: boolean };
      requeue_task: {
        Args: { p_delay_seconds: number; p_reason?: string; p_task_id: string };
        Returns: boolean;
      };
      search_knowledge: {
        Args: { p_limit?: number; p_org_id: string; p_query: string; p_query_embedding?: string };
        Returns: {
          chunk_id: string;
          content: string;
          document_id: string;
          score: number;
          title: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

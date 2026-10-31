-- Font faces (#50): Google Fonts copied into our storage, shared by every workspace, and fonts brands upload.
CREATE TABLE "font_faces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"brand_id" text,
	"source" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer NOT NULL,
	"style" text NOT NULL,
	"category" text,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "font_faces_face" UNIQUE NULLS NOT DISTINCT("workspace_id","brand_id","family","weight","style"),
	CONSTRAINT "font_faces_scope" CHECK (("font_faces"."source" = 'google' and "font_faces"."workspace_id" is null and "font_faces"."brand_id" is null) or ("font_faces"."source" = 'upload' and "font_faces"."workspace_id" is not null and "font_faces"."brand_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "font_faces" ADD CONSTRAINT "font_faces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "font_faces" ADD CONSTRAINT "font_faces_brand_in_workspace" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "font_faces_brand" ON "font_faces" USING btree ("workspace_id","brand_id");
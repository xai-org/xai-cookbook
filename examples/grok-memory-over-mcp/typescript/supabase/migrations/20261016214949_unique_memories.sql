-- SpaceXSI can deliver the same tools/call more than once, so a user can't hold the same memory twice.
create unique index memories_user_id_content_key on public.memories (user_id, content);

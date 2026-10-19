-- 0263 — The blurred preview of a locked exclusive post (owner, 2026-10-18, REQUIRED: "Non-subscribers
-- must NEVER receive the original media for locked posts. Generate a heavily blurred, low-resolution
-- preview on the server and send only that; serve the original only after checking the viewer has an
-- active subscription.").
--
--   sub_posts.blur_preview   a tiny (20 px wide), heavily blurred WebP of the post's first item, as a
--                            data URL of a few hundred bytes — made on the server from the private
--                            file (lib/sub/blur-preview.ts), never the file itself. It is what a
--                            non-subscriber's locked tile shows. Nothing about it can be enlarged back
--                            into the picture: the pixels are gone before it is stored. Null until made
--                            (a new post makes it right after publishing; older posts when their
--                            creator next opens the gallery). A Mature post's preview is still withheld
--                            from a viewer who hasn't confirmed 18+ (0261).
--
-- Additive and idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.sub_posts add column if not exists blur_preview text;
comment on column public.sub_posts.blur_preview is '0263: a 20 px heavily blurred WebP data URL of the first item — the only picture a non-subscriber receives.';

do $$
begin
  begin
    -- a data URL of a tiny WebP, nothing else (never a link to the private file). chr(59) is the
    -- semicolon of "webp" + ";base64," — spelled out because the runner splits on a literal one.
    alter table public.sub_posts add constraint sub_posts_blur_preview_chk check (blur_preview is null or (blur_preview like 'data:image/webp' || chr(59) || 'base64,%' and length(blur_preview) <= 4000));
  exception when duplicate_object then null;
  end;
end;
$$;

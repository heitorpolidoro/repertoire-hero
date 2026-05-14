-- Update handle_new_user trigger to also save instruments and primary_instrument
-- from auth metadata (passed via supabase.auth.signUp options.data).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, instruments, primary_instrument)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name',
        COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data -> 'instruments')),
            '{}'
        ),
        NEW.raw_user_meta_data ->> 'primary_instrument'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

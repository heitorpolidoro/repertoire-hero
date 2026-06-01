-- ---------------------------------------------------------------------------
-- Permite que qualquer usuário autenticado edite qualquer música global.
-- Isso possibilita que usuários adicionem links, editem o tom padrão e corrijam
-- metadados em um catálogo totalmente colaborativo (Wiki).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "global_songs: contributor can update own rows" ON global_songs;

CREATE POLICY "global_songs: authenticated users can update all rows"
    ON global_songs FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

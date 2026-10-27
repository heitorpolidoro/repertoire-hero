-- RH-185: respell the three word tuning presets to their canonical 6th-string
-- note names (`Standard` -> `E`, `Half step down` -> `Eb`, `Whole step down`
-- -> `D`) across `user_songs.tuning`, `band_songs.tuning` and
-- `song_versions.tuning`. `Drop D` is already canonical; every other value
-- (`DADGAD`, `Open G`, `Open D`, free text, `NULL`) is left untouched.

UPDATE user_songs
SET tuning = CASE tuning
    WHEN 'Standard' THEN 'E'
    WHEN 'Half step down' THEN 'Eb'
    WHEN 'Whole step down' THEN 'D'
END
WHERE tuning IN ('Standard', 'Half step down', 'Whole step down');

UPDATE band_songs
SET tuning = CASE tuning
    WHEN 'Standard' THEN 'E'
    WHEN 'Half step down' THEN 'Eb'
    WHEN 'Whole step down' THEN 'D'
END
WHERE tuning IN ('Standard', 'Half step down', 'Whole step down');

UPDATE song_versions
SET tuning = CASE tuning
    WHEN 'Standard' THEN 'E'
    WHEN 'Half step down' THEN 'Eb'
    WHEN 'Whole step down' THEN 'D'
END
WHERE tuning IN ('Standard', 'Half step down', 'Whole step down');

UPDATE portfolio_settings
SET tagline = 'Strateški projekti, regulatorne obaveze i operativna unapređenja — razdvojeno, ali upravljano iz jednog pregleda.',
    updated_at = now()
WHERE id = 1
  AND tagline = 'Strateške promene, obavezne inicijative i operativna unapređenja — razdvojeno, ali upravljano iz jednog pregleda.';

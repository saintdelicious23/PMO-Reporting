UPDATE portfolio_settings
SET title = 'Projekti koji moraju ostati u jasnom fokusu.',
    updated_at = now()
WHERE id = 1
  AND title = 'Projects that need a clear line of sight.';

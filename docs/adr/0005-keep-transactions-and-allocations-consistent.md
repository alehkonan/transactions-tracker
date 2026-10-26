# Keep transactions and allocations consistent

A transaction and its accompanying allocation are created, edited, and deleted together: changing the transaction's amount, currency, or date updates the allocation, and deleting the transaction removes it. This prevents account balances and sphere balances from drifting through independent edits to two records describing the same money movement.

New transfers retain two transaction records, each with its own allocation, but the sides are linked and edited or deleted as one operation. We chose this over leaving the sides independent because correcting or deleting one leg alone could change total tracked holdings accidentally; amounts must match in the same currency, while different amounts remain valid for currency exchanges. Transfer fees are recorded as separate expenses with their own categories and spheres.

Existing unlinked transfer records are preserved independently and each receives an Operating allocation during migration. Pairing is mandatory for new transfers; legacy records may be paired manually, but migration must not guess pairs from coincidentally similar dates and amounts.

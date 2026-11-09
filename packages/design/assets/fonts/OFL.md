# Font licences

The TTF files in this folder are used to render flyers on the server (`lib/render/`).
Every family is licensed under the SIL Open Font License 1.1, which allows bundling and
redistribution with software: https://openfontlicense.org

Inter (Rasmus Andersson), Montserrat (Julieta Ulanovsky et al.), Playfair Display
(Claus Eggers Sørensen), Cormorant Garamond (Christian Thalmann), DM Serif Display
(Colophon Foundry), Bebas Neue (Ryoichi Tsunekawa), Anton (Vernon Adams), Oswald
(Vernon Adams et al.), Space Grotesk (Florian Karsten), Great Vibes (TypeSETit),
Caveat (Impallari Type), and Noto Sans (Google) as the fallback for characters outside
the Latin subsets, such as ₦ (`fallback-noto-*.ttf`).

Files are the Latin subsets from Fontsource; re-download with `node scripts/fetch-fonts.mjs`.

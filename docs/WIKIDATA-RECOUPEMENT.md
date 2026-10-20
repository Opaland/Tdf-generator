# Recoupement des villes-étapes avec Wikidata

Généré le 2026-10-20 par `node scripts/wikidata-crosscheck.js --md` (backlog 34.1).
Source : Wikidata (CC0), query.wikidata.org. 118 éditions comparées à `pipeline/data/stage_towns.json`.

**Ce sont des pistes, pas des corrections.** Un écart vient aussi bien d'un homonyme
géocodé chez nous que d'une erreur ou d'une date décalée sur Wikidata. Chaque
correction passe par la curation, source citée (CLAUDE.md règle 12).

- Villes à plus de 10 km de la ville Wikidata : 25 départs, 16 arrivées
- Distances à plus de 5 % (et 1 km) de Wikidata : 16
- Dates décalées (mêmes villes, autre jour sur Wikidata) : 28
- Étapes sans correspondance (ni mêmes villes à ±2 jours, ni même jour) : 0

Appariement : mêmes villes (à 10 km près) le même jour, puis à ±2 jours
(date décalée), puis, à défaut, même jour et distance la plus proche — seul
ce dernier cas peut faire apparaître un homonyme. Une ligne par occurrence :
une ville présente dans deux étapes apparaît deux fois.

## Villes

| Étape | Écart | Confiance actuelle |
|---|---|---|
| 1903/1 (départ) | « Paris » placé à 15 km de « Villeneuve-Saint-Georges » (Wikidata Q244241) | ok |
| 1903/6 (arrivée) | « Paris » placé à 12 km de « Ville-d'Avray » (Wikidata Q456327) | ok |
| 1905/1 (départ) | « Paris » placé à 15 km de « Noisy-le-Grand » (Wikidata Q207605) | ok |
| 1926/1 (arrivée) | « Mülhausen » placé à 127 km de « Mulhouse » (Wikidata Q79815) | ok |
| 1926/2 (départ) | « Mülhausen » placé à 127 km de « Mulhouse » (Wikidata Q79815) | ok |
| 1938/1 (départ) | « Paris » placé à 16 km de « Le Vésinet » (Wikidata Q641607) | ok |
| 1939/16a (arrivée) | « Briançon » placé à 61 km de « Bonneval-sur-Arc » (Wikidata Q736370) | ok |
| 1947/1 (départ) | « Paris » placé à 12 km de « Pierrefitte-sur-Seine » (Wikidata Q253939) | ok |
| 1947/17 (départ) | « Bordeaux » placé à 20 km de « Saint-André-de-Cubzac » (Wikidata Q667867) | ok |
| 1948/1 (arrivée) | « Trouville-sur-Mer » placé à 44 km de « Trouville, Seine-Maritime » (Wikidata Q900702) | ok |
| 1948/2 (départ) | « Trouville-sur-Mer » placé à 44 km de « Trouville, Seine-Maritime » (Wikidata Q900702) | ok |
| 1959/18 (départ) | « Grenoble » placé à 55 km de « col du Lautaret » (Wikidata Q1107509) | ok |
| 1962/21 (arrivée) | « Nevers » placé à 11 km de « Pougues-les-Eaux » (Wikidata Q46575) | ok |
| 1962/22 (départ) | « Nevers » placé à 11 km de « Pougues-les-Eaux » (Wikidata Q46575) | ok |
| 1964/7 (départ) | « Besançon » placé à 55 km de « Champagnole » (Wikidata Q477013) | ok |
| 1964/13 (arrivée) | « Andorra » placé à 49 km de « Andorre-la-Vieille » (Wikidata Q1863) | douteux |
| 1964/14 (départ) | « Andorra » placé à 49 km de « Andorre-la-Vieille » (Wikidata Q1863) | douteux |
| 1969/19 (départ) | « Bordeaux » placé à 28 km de « Libourne » (Wikidata Q6544) | ok |
| 1970/8 (arrivée) | « Felsberg » placé à 287 km de « Émetteur d'Europe 1 » (Wikidata Q896321) | ok |
| 1973/6 (départ) | « Mulhouse » placé à 38 km de « Belfort » (Wikidata Q171545) | ok |
| 1973/7b (arrivée) | « Méribel » placé à 58 km de « Les Allues » (Wikidata Q537798) | douteux |
| 1973/8 (départ) | « Moûtiers » placé à 419 km de « Moutiers » (Wikidata Q208732) | ambigu |
| 1982/1 (départ) | « Basel » placé à 29 km de « Schupfart » (Wikidata Q66314) | ok |
| 1982/11 (départ) | « Valence d'Agen » placé à 330 km de « Valence » (Wikidata Q8848) | ok |
| 1982/11 (arrivée) | « Valence d'Agen » placé à 330 km de « Valence » (Wikidata Q8848) | ok |
| 1984/6 (départ) | « Louvroil » placé à 193 km de « Cergy-Pontoise » (Wikidata Q18681428) | ok |
| 1993/16 (départ) | « Andorra » placé à 49 km de « Andorre-la-Vieille » (Wikidata Q1863) | douteux |
| 1994/3 (arrivée) | « Eurotunnel » placé à 29 km de « tunnel sous la Manche » (Wikidata Q10257) | verifie |
| 1994/18 (départ) | « Moûtiers » placé à 419 km de « Moutiers » (Wikidata Q208732) | ambigu |
| 1997/11 (départ) | « Andorra Arcalis » placé à 14 km de « Andorre-la-Vieille » (Wikidata Q1863) | ok |
| 1997/16 (arrivée) | « Fribourg » placé à 14 km de « Fribourg » (Wikidata Q36378) | ok |
| 1997/17 (départ) | « Fribourg » placé à 14 km de « Fribourg » (Wikidata Q36378) | ok |
| 2001/19 (arrivée) | « Évry » placé à 73 km de « Évry » (Wikidata Q192393) | douteux |
| 2003/1 (départ) | « Saint-Denis » placé à 27 km de « Montgeron » (Wikidata Q242569) | ok |
| 2011/1 (arrivée) | « Mont des Alouettes » placé à 64 km de « mont des Alouettes » (Wikidata Q956593) | douteux |
| 2014/21 (départ) | « Évry » placé à 73 km de « Évry » (Wikidata Q192393) | douteux |
| 2015/2 (arrivée) | « Zeeland » placé à 23 km de « Neeltje Jans » (Wikidata Q2330240) | ok |
| 2020/17 (arrivée) | « Méribel » placé à 61 km de « col de la Loze » (Wikidata Q86666408) | douteux |
| 2020/18 (départ) | « Méribel » placé à 62 km de « Méribel » (Wikidata Q914361) | douteux |
| 2024/1 (arrivée) | « Rimini » placé à 14 km de « Rimini » (Wikidata Q13369) | ok |
| 2024/3 (départ) | « Piacenza » placé à 23 km de « Plaisance » (Wikidata Q13329) | ok |

## Distances

| Étape | Écart | Confiance actuelle |
|---|---|---|
| 1906/6 | 292 km ici, 308 km sur Wikidata (-5.2 %) | — |
| 1906/13 | 259 km ici, 246 km sur Wikidata (+5.3 %) | — |
| 1927/15 | 220 km ici, 280 km sur Wikidata (-21.4 %) | — |
| 1952/15 | 255 km ici, 275 km sur Wikidata (-7.3 %) | — |
| 1964/20 | 217 km ici, 237.5 km sur Wikidata (-8.6 %) | — |
| 1965/20 | 198.5 km ici, 298.5 km sur Wikidata (-33.5 %) | — |
| 1970/5b | 223 km ici, 113 km sur Wikidata (+97.3 %) | — |
| 1970/16 | 160 km ici, 259.5 km sur Wikidata (-38.3 %) | — |
| 1980/5 | 249 km ici, 236.5 km sur Wikidata (+5.3 %) | — |
| 1985/13 | 32 km ici, 38 km sur Wikidata (-15.8 %) | — |
| 1987/11 | 206 km ici, 255 km sur Wikidata (-19.2 %) | — |
| 1988/prologue | 3.8 km ici, 1 km sur Wikidata (+280.0 %) | — |
| 1988/16 | 35 km ici, 38 km sur Wikidata (-7.9 %) | — |
| 1988/17 | 198 km ici, 210 km sur Wikidata (-5.7 %) | — |
| 1998/12 | 190 km ici, 206 km sur Wikidata (-7.8 %) | — |
| 2019/14 | 111 km ici, 117.5 km sur Wikidata (-5.5 %) | — |

## Dates décalées

| Étape | Écart | Confiance actuelle |
|---|---|---|
| 1905/3 | le 1905-07-14 ici, le 1905-07-15 sur Wikidata (mêmes villes) | — |
| 1905/7 | le 1905-07-22 ici, le 1905-07-23 sur Wikidata (mêmes villes) | — |
| 1905/8 | le 1905-07-24 ici, le 1905-07-25 sur Wikidata (mêmes villes) | — |
| 1905/9 | le 1905-07-26 ici, le 1905-07-27 sur Wikidata (mêmes villes) | — |
| 1905/10 | le 1905-07-28 ici, le 1905-07-29 sur Wikidata (mêmes villes) | — |
| 1905/11 | le 1905-07-29 ici, le 1905-07-30 sur Wikidata (mêmes villes) | — |
| 1907/5 | le 1907-07-16 ici, le 1907-07-15 sur Wikidata (mêmes villes) | — |
| 1912/12 | le 1912-07-21 ici, le 1912-07-22 sur Wikidata (mêmes villes) | — |
| 1920/9 | le 1920-07-14 ici, le 1920-07-13 sur Wikidata (mêmes villes) | — |
| 1920/10 | le 1920-07-16 ici, le 1920-07-15 sur Wikidata (mêmes villes) | — |
| 1920/11 | le 1920-07-18 ici, le 1920-07-17 sur Wikidata (mêmes villes) | — |
| 1920/12 | le 1920-07-20 ici, le 1920-07-19 sur Wikidata (mêmes villes) | — |
| 1920/13 | le 1920-07-22 ici, le 1920-07-21 sur Wikidata (mêmes villes) | — |
| 1920/14 | le 1920-07-24 ici, le 1920-07-23 sur Wikidata (mêmes villes) | — |
| 1920/15 | le 1920-07-27 ici, le 1920-07-25 sur Wikidata (mêmes villes) | — |
| 1948/7 | le 1948-07-07 ici, le 1948-07-06 sur Wikidata (mêmes villes) | — |
| 1948/17 | le 1948-07-21 ici, le 1948-07-20 sur Wikidata (mêmes villes) | — |
| 1948/18 | le 1948-07-22 ici, le 1948-07-21 sur Wikidata (mêmes villes) | — |
| 1950/20 | le 1950-08-05 ici, le 1950-08-04 sur Wikidata (mêmes villes) | — |
| 1951/17 | le 1951-07-22 ici, le 1951-07-21 sur Wikidata (mêmes villes) | — |
| 1954/17 | le 1954-07-26 ici, le 1954-07-25 sur Wikidata (mêmes villes) | — |
| 1955/10 | le 1955-07-17 ici, le 1955-07-16 sur Wikidata (mêmes villes) | — |
| 1957/15b | le 1957-07-13 ici, le 1957-07-12 sur Wikidata (mêmes villes) | — |
| 1977/13a | le 1977-07-15 ici, le 1977-07-14 sur Wikidata (mêmes villes) | — |
| 1977/13b | le 1977-07-15 ici, le 1977-07-14 sur Wikidata (mêmes villes) | — |
| 1983/21 | le 1983-07-23 ici, le 1983-07-22 sur Wikidata (mêmes villes) | — |
| 1986/14 | le 1986-07-17 ici, le 1986-07-18 sur Wikidata (mêmes villes) | — |
| 1986/18 | le 1986-07-21 ici, le 1986-07-20 sur Wikidata (mêmes villes) | — |

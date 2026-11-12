-- Licencia que exige cada movil de la flota demo (Disposicion ANSV 20/2019: clase del vehiculo + D.4).
-- Igual que el paso 7 del seed. Solo completa moviles "Sin configurar": respeta lo cargado a mano.
UPDATE "Vehicle" SET "licenseCategory" = 'HEAVY'       WHERE "id" = 'demo_v2_vehicle_0' AND "licenseCategory" = 'UNSET'; -- M-14 autobomba pesada Mercedes Atego
UPDATE "Vehicle" SET "licenseCategory" = 'MEDIUM'      WHERE "id" = 'demo_v2_vehicle_1' AND "licenseCategory" = 'UNSET'; -- M-8 rescate Iveco Daily 4x4
UPDATE "Vehicle" SET "licenseCategory" = 'EXTRA_HEAVY' WHERE "id" = 'demo_v2_vehicle_2' AND "licenseCategory" = 'UNSET'; -- M-21 cisterna Scania P310
UPDATE "Vehicle" SET "licenseCategory" = 'LIGHT'       WHERE "id" = 'demo_v2_vehicle_3' AND "licenseCategory" = 'UNSET'; -- M-4 forestal Toyota Hilux
UPDATE "Vehicle" SET "licenseCategory" = 'LIGHT'       WHERE "id" = 'demo_v2_vehicle_4' AND "licenseCategory" = 'UNSET'; -- M-2 logistica Renault Master
UPDATE "Vehicle" SET "licenseCategory" = 'MEDIUM'      WHERE "id" = 'demo_v2_vehicle_5' AND "licenseCategory" = 'UNSET'; -- M-1 autobomba Ford F-600

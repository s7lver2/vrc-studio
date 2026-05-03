-- Relación N:M entre paquetes custom y assets del inventory
CREATE TABLE IF NOT EXISTS custom_package_assets (
    package_id        TEXT NOT NULL REFERENCES custom_packages(id) ON DELETE CASCADE,
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id)  ON DELETE CASCADE,
    PRIMARY KEY (package_id, inventory_item_id)
);
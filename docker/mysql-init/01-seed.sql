-- Random test data for MySQL. Runs once on first container start.
SET SESSION cte_max_recursion_depth = 100000;

CREATE TABLE customers (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(120)   NOT NULL,
    email      VARCHAR(160)   NOT NULL UNIQUE,
    country    VARCHAR(4)     NOT NULL,
    created_at DATETIME       NOT NULL
);

CREATE TABLE products (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    sku      VARCHAR(20)    NOT NULL UNIQUE,
    name     VARCHAR(120)   NOT NULL,
    price    DECIMAL(10,2)  NOT NULL,
    in_stock INT            NOT NULL
);

CREATE TABLE orders (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT          NOT NULL,
    status      VARCHAR(20)  NOT NULL,
    placed_at   DATETIME     NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    order_id   INT           NOT NULL,
    product_id INT           NOT NULL,
    quantity   INT           NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id)   REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 500 random customers
INSERT INTO customers (name, email, country, created_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 500)
SELECT
    CONCAT(
        ELT(1+FLOOR(RAND()*20),'Alice','Bob','Carla','Diego','Elena','Farid','Giulia','Hiro','Ivan','Jana','Karim','Lucia','Marco','Nina','Omar','Priya','Quentin','Rosa','Sven','Tara'),
        ' ',
        ELT(1+FLOOR(RAND()*15),'Rossi','Bianchi','Khan','Smith','Novak','Sato','Meyer','Costa','Popov','Silva','Dubois','Wang','Ali','Ferrari','Jensen')),
    CONCAT('user', n, '@example.com'),
    ELT(1+FLOOR(RAND()*10),'IT','US','DE','FR','ES','JP','BR','IN','UK','NL'),
    NOW() - INTERVAL FLOOR(RAND()*730) DAY
FROM seq;

-- 120 random products
INSERT INTO products (sku, name, price, in_stock)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 120)
SELECT
    CONCAT('SKU-', LPAD(n, 5, '0')),
    CONCAT(
        ELT(1+FLOOR(RAND()*10),'Widget','Gadget','Gizmo','Doohickey','Contraption','Sprocket','Cog','Lever','Bolt','Panel'),
        ' ',
        ELT(1+FLOOR(RAND()*8),'Mini','Pro','Max','Lite','Ultra','Classic','Neo','Plus')),
    ROUND(RAND()*490 + 10, 2),
    FLOOR(RAND()*500)
FROM seq;

-- 2000 random orders
INSERT INTO orders (customer_id, status, placed_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 2000)
SELECT
    1 + FLOOR(RAND()*500),
    ELT(1+FLOOR(RAND()*5),'pending','paid','shipped','delivered','cancelled'),
    NOW() - INTERVAL FLOOR(RAND()*365) DAY
FROM seq;

-- ~6000 random order line items, priced from the referenced product
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 6000)
SELECT
    1 + FLOOR(RAND()*2000),
    p.id,
    1 + FLOOR(RAND()*5),
    p.price
FROM seq
JOIN products p ON p.id = 1 + FLOOR(RAND()*120);

CREATE INDEX idx_orders_customer   ON orders (customer_id);
CREATE INDEX idx_items_order       ON order_items (order_id);
CREATE INDEX idx_items_product     ON order_items (product_id);

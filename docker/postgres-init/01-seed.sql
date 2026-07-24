-- Random test data for Postgres. Runs once on first container start.
SET client_min_messages = warning;

CREATE TABLE customers (
    id          serial PRIMARY KEY,
    name        text        NOT NULL,
    email       text        NOT NULL UNIQUE,
    country     text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id       serial PRIMARY KEY,
    sku      text          NOT NULL UNIQUE,
    name     text          NOT NULL,
    price    numeric(10,2) NOT NULL,
    in_stock integer       NOT NULL
);

CREATE TABLE orders (
    id          serial PRIMARY KEY,
    customer_id integer     NOT NULL REFERENCES customers(id),
    status      text        NOT NULL,
    placed_at   timestamptz NOT NULL
);

CREATE TABLE order_items (
    id         serial PRIMARY KEY,
    order_id   integer       NOT NULL REFERENCES orders(id),
    product_id integer       NOT NULL REFERENCES products(id),
    quantity   integer       NOT NULL,
    unit_price numeric(10,2) NOT NULL
);

-- 500 random customers
INSERT INTO customers (name, email, country, created_at)
SELECT
    (ARRAY['Alice','Bob','Carla','Diego','Elena','Farid','Giulia','Hiro','Ivan','Jana','Karim','Lucia','Marco','Nina','Omar','Priya','Quentin','Rosa','Sven','Tara'])[1 + floor(random()*20)::int]
      || ' ' ||
    (ARRAY['Rossi','Bianchi','Khan','Smith','Novak','Sato','Meyer','Costa','Popov','Silva','Dubois','Wang','Ali','Ferrari','Jensen'])[1 + floor(random()*15)::int],
    'user' || g || '@example.com',
    (ARRAY['IT','US','DE','FR','ES','JP','BR','IN','UK','NL'])[1 + floor(random()*10)::int],
    now() - (random()*730 || ' days')::interval
FROM generate_series(1, 500) AS g;

-- 120 random products
INSERT INTO products (sku, name, price, in_stock)
SELECT
    'SKU-' || lpad(g::text, 5, '0'),
    (ARRAY['Widget','Gadget','Gizmo','Doohickey','Contraption','Sprocket','Cog','Lever','Bolt','Panel'])[1 + floor(random()*10)::int]
      || ' ' ||
    (ARRAY['Mini','Pro','Max','Lite','Ultra','Classic','Neo','Plus'])[1 + floor(random()*8)::int],
    round((random()*490 + 10)::numeric, 2),
    floor(random()*500)::int
FROM generate_series(1, 120) AS g;

-- 2000 random orders
INSERT INTO orders (customer_id, status, placed_at)
SELECT
    1 + floor(random()*500)::int,
    (ARRAY['pending','paid','shipped','delivered','cancelled'])[1 + floor(random()*5)::int],
    now() - (random()*365 || ' days')::interval
FROM generate_series(1, 2000) AS g;

-- 1-5 line items per order, priced from the referenced product
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
    o.id,
    p.id,
    1 + floor(random()*5)::int,
    p.price
FROM orders o
CROSS JOIN generate_series(1, 5) AS n            -- up to 5 candidate slots per order
JOIN LATERAL (
    SELECT id, price FROM products ORDER BY random() LIMIT 1
) p ON true
WHERE n <= 1 + floor(random()*5)::int;           -- keep a random subset -> 1..5 items

CREATE INDEX ON orders (customer_id);
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON order_items (product_id);

CREATE TABLE IF NOT EXISTS incomes (
    id VARCHAR(50) PRIMARY KEY,
    amount DECIMAL(12,2) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT DEFAULT '',
    datetime TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
    id VARCHAR(50) PRIMARY KEY,
    amount DECIMAL(12,2) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT DEFAULT '',
    datetime TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mandatory_payments (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    category VARCHAR(100) NOT NULL,
    day INTEGER,
    type VARCHAR(20) DEFAULT 'monthly',
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
    ('cash', '"0"'::jsonb),
    ('salary', '{"day": null, "amount": 0, "period": "monthly"}'::jsonb),
    ('income_categories', '["Зарплата","Фриланс","Подработка","Подарок","Инвестиции","Прочее"]'::jsonb),
    ('expense_categories', '["Еда","Транспорт","Жильё","Одежда","Здоровье","Развлечения","Связь","Коммуналка","Кредит","Прочее"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

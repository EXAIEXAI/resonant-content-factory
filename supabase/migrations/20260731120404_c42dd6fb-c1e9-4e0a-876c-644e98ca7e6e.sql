DELETE FROM public.user_roles WHERE user_id IN ('da5626be-9b3a-435b-a3c6-ecc015c05217','31a7c8c3-2bfb-46ce-b8ee-d572e752df7f','aded8bc2-dfa4-48c3-b52d-b6081ec3cc2c');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('da5626be-9b3a-435b-a3c6-ecc015c05217','admin'),
  ('31a7c8c3-2bfb-46ce-b8ee-d572e752df7f','admin'),
  ('aded8bc2-dfa4-48c3-b52d-b6081ec3cc2c','product_owner');
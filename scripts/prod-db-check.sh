SQL="
SELECT b.id, b.title, b.\"createdAt\"
FROM boards b WHERE b.title = 'Моя доска';

SELECT c.title, c.position AS col_pos, count(k.id) AS cards
FROM columns c LEFT JOIN cards k ON k.\"columnId\" = c.id
WHERE c.\"boardId\" = (SELECT id FROM boards WHERE title = 'Моя доска' ORDER BY \"createdAt\" LIMIT 1)
GROUP BY c.id, c.title, c.position ORDER BY c.position;

SELECT k.id, k.title, c.title AS col, k.position, k.\"updatedAt\"
FROM cards k JOIN columns c ON c.id = k.\"columnId\"
WHERE c.\"boardId\" = (SELECT id FROM boards WHERE title = 'Моя доска' ORDER BY \"createdAt\" LIMIT 1);
"
cd ~/task-board || exit 1
echo "$SQL" | docker compose exec -T db psql -U postgres -d task_board

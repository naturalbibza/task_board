SQL="
SELECT b.id, b.title, b.\"createdAt\", count(DISTINCT bm.\"userId\") AS members,
       count(DISTINCT k.id) AS cards,
       max(k.\"updatedAt\") AS last_card_update
FROM boards b
LEFT JOIN board_members bm ON bm.\"boardId\" = b.id
LEFT JOIN columns c ON c.\"boardId\" = b.id
LEFT JOIN cards k ON k.\"columnId\" = c.id
GROUP BY b.id, b.title, b.\"createdAt\"
ORDER BY b.\"createdAt\" DESC
LIMIT 10;

SELECT k.title, k.\"updatedAt\", c.title AS col, k.position
FROM cards k JOIN columns c ON c.id = k.\"columnId\"
ORDER BY k.\"updatedAt\" DESC LIMIT 10;
"
cd ~/task-board || exit 1
echo "$SQL" | docker compose exec -T db psql -U postgres -d task_board

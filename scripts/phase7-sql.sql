SELECT c.title, k.title AS card, k."position"
FROM cards k JOIN columns c ON c."id"=k."columnId"
WHERE c."boardId"=(SELECT id FROM boards WHERE title='NFR-4' ORDER BY "createdAt" DESC LIMIT 1) AND c.title='To Do'
ORDER BY k."position";

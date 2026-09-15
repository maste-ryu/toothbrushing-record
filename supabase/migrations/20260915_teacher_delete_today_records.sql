-- 允許已驗證的教師清除誤登潔牙／請假紀錄。
-- kiosk 角色沒有 delete policy，因此學生畫面仍無法取消或更正紀錄。

grant delete on table public.brushing_records to authenticated;

drop policy if exists brushing_records_teacher_delete on public.brushing_records;
create policy brushing_records_teacher_delete
on public.brushing_records
for delete
to authenticated
using (private.has_role('teacher'));

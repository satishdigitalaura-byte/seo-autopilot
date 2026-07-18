-- manager_agent isn't scoped to one site (it watches every agent across all
-- sites), so it has no site_id to give agent_results — which required one.
alter table agent_results alter column site_id drop not null;

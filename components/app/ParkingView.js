"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/appapi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bike, Car, Plus, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

const META = {
  four_wheeler: {
    label: "4 Wheeler",
    prefix: "FW",
    capacity: 12,
    Icon: Car,
    color: "text-[#2E7CD6]",
    soft: "bg-[#E8F1FB]",
  },
  two_wheeler: {
    label: "2 Wheeler",
    prefix: "TW",
    capacity: 90,
    Icon: Bike,
    color: "text-[#1B7F6E]",
    soft: "bg-[#E4F5EE]",
  },
};

function AllocateParking({ members, allocations, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    member_id: "",
    vehicle_type: "four_wheeler",
    vehicle_number: "",
    slot_number: "auto",
    notes: "",
  });
  const meta = META[form.vehicle_type];
  const occupied = new Set(
    allocations
      .filter((row) => row.vehicle_type === form.vehicle_type)
      .map((row) => row.slot_number),
  );
  const submit = async () => {
    if (!form.member_id || !form.vehicle_number.trim())
      return toast.error("Member and vehicle number are required");
    try {
      await api("/parking", {
        method: "POST",
        body: {
          ...form,
          slot_number:
            form.slot_number === "auto" ? null : Number(form.slot_number),
        },
      });
      toast.success("Parking allocated");
      setOpen(false);
      setForm({
        member_id: "",
        vehicle_type: "four_wheeler",
        vehicle_number: "",
        slot_number: "auto",
        notes: "",
      });
      onCreated();
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#131C26] hover:bg-[#1C2836]">
          <Plus className="h-4 w-4" />
          Allocate parking
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Allocate Tulip parking</DialogTitle>
          <p className="text-sm text-[#9CA3AF]">
            Assign a vehicle slot to a member.
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Member</Label>
            <Select
              value={form.member_id}
              onValueChange={(value) => setForm({ ...form, member_id: value })}
            >
              <SelectTrigger className="mt-1">
                <UserRound className="h-4 w-4" />
                <SelectValue placeholder="Select member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name} · {member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vehicle type</Label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {Object.entries(META).map(([value, item]) => {
                const Icon = item.Icon;
                const used = allocations.filter(
                  (row) => row.vehicle_type === value,
                ).length;
                return (
                  <button
                    type="button"
                    key={value}
                    onClick={() =>
                      setForm({
                        ...form,
                        vehicle_type: value,
                        slot_number: "auto",
                      })
                    }
                    className={`flex items-center gap-3 rounded-xl border p-4 text-left ${form.vehicle_type === value ? "border-[#1B7F6E] bg-[#F4FBF8] ring-1 ring-[#1B7F6E]" : "border-[#E5E9EF]"}`}
                  >
                    <span
                      className={`grid h-10 w-10 place-items-center rounded-lg ${item.soft}`}
                    >
                      <Icon className={`h-5 w-5 ${item.color}`} />
                    </span>
                    <span>
                      <b className="block text-sm">{item.label}</b>
                      <span className="text-xs text-[#9CA3AF]">
                        {item.capacity - used} available
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Vehicle number</Label>
              <Input
                className="mt-1 uppercase"
                placeholder="HR 26 AB 1234"
                value={form.vehicle_number}
                onChange={(event) =>
                  setForm({
                    ...form,
                    vehicle_number: event.target.value.toUpperCase(),
                  })
                }
              />
            </div>
            <div>
              <Label>Parking slot</Label>
              <Select
                value={form.slot_number}
                onValueChange={(value) =>
                  setForm({ ...form, slot_number: value })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Auto-assign next available
                  </SelectItem>
                  {Array.from(
                    { length: meta.capacity },
                    (_, index) => index + 1,
                  )
                    .filter((slot) => !occupied.has(slot))
                    .map((slot) => (
                      <SelectItem key={slot} value={String(slot)}>
                        {meta.prefix}-{String(slot).padStart(2, "0")}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>
              Notes{" "}
              <span className="font-normal text-[#9CA3AF]">(optional)</span>
            </Label>
            <Input
              className="mt-1"
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Allocate slot</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ParkingView() {
  const [data, setData] = useState({ allocations: [] });
  const [members, setMembers] = useState([]);
  const [type, setType] = useState("four_wheeler");
  const [search, setSearch] = useState("");
  const load = () =>
    Promise.all([api("/parking"), api("/users")])
      .then(([parking, users]) => {
        setData(parking);
        setMembers(users.filter((user) => user.role !== "super_admin"));
      })
      .catch((error) => toast.error(error.message));
  useEffect(() => {
    load();
  }, []);
  const meta = META[type];
  const typeRows = data.allocations.filter((row) => row.vehicle_type === type);
  const bySlot = new Map(typeRows.map((row) => [row.slot_number, row]));
  const zoneSize = type === "four_wheeler" ? 6 : 30;
  const zones = Array.from(
    { length: Math.ceil(meta.capacity / zoneSize) },
    (_, zoneIndex) =>
      Array.from(
        { length: Math.min(zoneSize, meta.capacity - zoneIndex * zoneSize) },
        (_, slotIndex) => zoneIndex * zoneSize + slotIndex + 1,
      ),
  );
  const occupancy = Math.round((typeRows.length / meta.capacity) * 100);
  const ActiveVehicleIcon = meta.Icon;
  const visible = data.allocations.filter(
    (row) =>
      !search ||
      `${row.member_name} ${row.member_email} ${row.vehicle_number}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const remove = async (row) => {
    try {
      await api(`/parking/${row.id}`, { method: "DELETE" });
      toast.success("Parking allocation removed");
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <div className="space-y-5 text-[#111827]">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-bold">Tulip parking allocation</h2>
          <p className="text-sm text-[#9CA3AF]">
            Manage vehicle spaces for members at Tulip.
          </p>
        </div>
        <AllocateParking
          members={members}
          allocations={data.allocations}
          onCreated={load}
        />
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
          <Input
            className="w-64 bg-white pl-9"
            placeholder="Search member or vehicle…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            "Total capacity",
            102,
            "12 cars · 90 two-wheelers",
            "text-[#111827]",
          ],
          [
            "Allocated",
            data.allocations.length,
            "active allocations",
            "text-[#1B7F6E]",
          ],
          [
            "Available",
            102 - data.allocations.length,
            "spaces ready",
            "text-[#2E7CD6]",
          ],
        ].map(([label, value, hint, tone]) => (
          <Card key={label} className="border-[#E5E9EF] p-5 shadow-none">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              {label}
            </p>
            <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
            <p className="text-xs text-[#9CA3AF]">{hint}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
        <div className="flex flex-wrap items-center gap-4 border-b bg-gradient-to-r from-white to-[#FAFBFC] p-5">
          <div className="flex rounded-lg bg-[#EDF0F4] p-1 sm:w-fit">
            {Object.entries(META).map(([value, item]) => (
              <button
                key={value}
                onClick={() => setType(value)}
                className={`relative rounded-md px-5 py-2 text-sm font-semibold transition-all duration-300 ${type === value ? "scale-[1.02] bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E9EF]" : "text-[#4B5563] hover:bg-white/60"}`}
              >
                {item.label} ·{" "}
                {
                  data.allocations.filter((row) => row.vehicle_type === value)
                    .length
                }
                /{item.capacity}
              </button>
            ))}
          </div>
          <div className="ml-auto min-w-52">
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-semibold text-[#4B5563]">Occupancy</span>
              <span className={meta.color}>{occupancy}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#EDF0F4]">
              <div
                className={`h-full rounded-full transition-all duration-700 ${type === "four_wheeler" ? "bg-[#2E7CD6]" : "bg-[#1B7F6E]"}`}
                style={{ width: `${occupancy}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#6B7280]">
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-full bg-[#1E9E6A]" />
              Allocated
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-full border border-dashed border-[#9CA3AF]" />
              Available
            </span>
          </div>
        </div>
        <div
          key={type}
          className="animate-in fade-in slide-in-from-bottom-2 space-y-5 p-5 duration-500"
        >
          {zones.map((slots, zoneIndex) => (
            <section
              key={zoneIndex}
              className="rounded-xl border border-[#EDF0F4] bg-[#FCFDFE] p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`grid h-7 w-7 place-items-center rounded-lg ${meta.soft}`}
                >
                  <ActiveVehicleIcon className={`h-4 w-4 ${meta.color}`} />
                </span>
                <div>
                  <p className="text-xs font-bold">
                    Zone {String.fromCharCode(65 + zoneIndex)}
                  </p>
                  <p className="text-[10px] text-[#9CA3AF]">
                    Slots {meta.prefix}-{String(slots[0]).padStart(2, "0")} to{" "}
                    {meta.prefix}-{String(slots.at(-1)).padStart(2, "0")}
                  </p>
                </div>
                <span className="ml-auto rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-[#6B7280] shadow-sm">
                  {slots.filter((slot) => bySlot.has(slot)).length}/
                  {slots.length} occupied
                </span>
              </div>
              <div
                className={`grid gap-2 ${type === "four_wheeler" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-10"}`}
              >
                {slots.map((slot, index) => {
                  const row = bySlot.get(slot);
                  return (
                    <div
                      key={slot}
                      title={
                        row
                          ? `${row.member_name} · ${row.vehicle_number}`
                          : "Available"
                      }
                      style={{
                        animationDelay: `${Math.min(index, 10) * 25}ms`,
                      }}
                      className={`group relative flex min-h-20 animate-in fade-in zoom-in-95 flex-col items-center justify-center overflow-hidden rounded-xl border p-2 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${row ? `${meta.soft} ${meta.color} border-current shadow-sm` : "border-dashed border-[#D9DEE5] bg-white text-[#9CA3AF] hover:border-[#1B7F6E]/50 hover:bg-[#F4FBF8]"}`}
                    >
                      <ActiveVehicleIcon
                        className={`mb-1 h-4 w-4 transition-transform duration-300 group-hover:scale-110 ${row ? meta.color : "text-[#C9D1DB]"}`}
                      />
                      <span className="text-[10px] font-bold">
                        {meta.prefix}-{String(slot).padStart(2, "0")}
                      </span>
                      {row ? (
                        <>
                          <span className="mt-1 max-w-full truncate text-[10px] font-semibold">
                            {row.member_name}
                          </span>
                          <span className="max-w-full truncate text-[9px]">
                            {row.vehicle_number}
                          </span>
                          <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-[#1E9E6A]" />
                        </>
                      ) : (
                        <span className="mt-1 text-[9px] transition-colors group-hover:text-[#1B7F6E]">
                          Available
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Card>
      <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
        <div className="border-b px-5 py-4">
          <h3 className="font-bold">Vehicle allocations</h3>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Allocated by</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const item = META[row.vehicle_type];
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-semibold">
                      {item.prefix}-{String(row.slot_number).padStart(2, "0")}
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold">{row.member_name}</p>
                      <p className="text-xs text-[#9CA3AF]">
                        {row.member_email}
                      </p>
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.vehicle_number}
                    </TableCell>
                    <TableCell>{item.label}</TableCell>
                    <TableCell>{row.allocated_by}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600"
                        onClick={() => remove(row)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!visible.length && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-[#9CA3AF]"
                  >
                    No vehicles allocated yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

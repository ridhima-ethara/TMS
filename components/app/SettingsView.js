"use client";

import { useEffect, useState } from "react";
import { api, ROLE_LABEL } from "@/lib/appapi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Settings2, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

const blank = {
  id: "",
  name: "",
  role: "employee",
  employee_id: "",
  location: "",
  active: true,
  is_team_head: false,
  password: "",
};

export default function SettingsView() {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const load = () =>
    api("/users")
      .then(setMembers)
      .catch((error) => toast.error(error.message));
  useEffect(() => {
    load();
  }, []);
  const visible = members.filter(
    (member) =>
      !search ||
      `${member.name} ${member.email} ${member.employee_id} ${member.role}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const save = async () => {
    try {
      const body = {
        name: editing.name,
        role: editing.role,
        employee_id: editing.employee_id,
        location: editing.location,
        active: editing.active,
        is_team_head: editing.is_team_head,
        password: editing.password || undefined,
      };
      await api(`/users/${editing.id}`, { method: "PATCH", body });
      toast.success("Member settings updated");
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <div className="space-y-5 text-[#111827]">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-bold">Member settings</h2>
          <p className="text-sm text-[#9CA3AF]">
            Manage registered accounts, roles, access and team-head permissions.
          </p>
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
          <Input
            className="w-72 bg-white pl-9"
            placeholder="Search members…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-[#E5E9EF] p-4 shadow-none">
          <Users className="h-5 w-5 text-[#2E7CD6]" />
          <p className="mt-3 text-2xl font-bold">{members.length}</p>
          <p className="text-xs text-[#9CA3AF]">Registered members</p>
        </Card>
        <Card className="border-[#E5E9EF] p-4 shadow-none">
          <ShieldCheck className="h-5 w-5 text-[#1B7F6E]" />
          <p className="mt-3 text-2xl font-bold">
            {members.filter((member) => member.is_team_head).length}
          </p>
          <p className="text-xs text-[#9CA3AF]">Team heads</p>
        </Card>
        <Card className="border-[#E5E9EF] p-4 shadow-none">
          <Settings2 className="h-5 w-5 text-[#6C5CE7]" />
          <p className="mt-3 text-2xl font-bold">
            {members.filter((member) => member.active !== false).length}
          </p>
          <p className="text-xs text-[#9CA3AF]">Active accounts</p>
        </Card>
      </div>
      <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Access</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <p className="font-semibold">{member.name}</p>
                    <p className="text-xs text-[#9CA3AF]">{member.email}</p>
                  </TableCell>
                  <TableCell>{member.employee_id || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant="outline">
                        {ROLE_LABEL[member.role] || member.role}
                      </Badge>
                      {member.is_team_head && (
                        <Badge className="bg-purple-100 text-purple-800">
                          Team head
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{member.location || "—"}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        member.active === false
                          ? "bg-red-100 text-red-800"
                          : "bg-green-100 text-green-800"
                      }
                    >
                      {member.active === false ? "Disabled" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEditing({ ...blank, ...member, password: "" })
                      }
                    >
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manage member</DialogTitle>
            <p className="text-sm text-[#9CA3AF]">{editing?.email}</p>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    className="mt-1"
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ ...editing, name: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Employee ID</Label>
                  <Input
                    className="mt-1"
                    value={editing.employee_id || ""}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        employee_id: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Role</Label>
                  <Select
                    value={editing.role}
                    onValueChange={(role) =>
                      setEditing({
                        ...editing,
                        role,
                        is_team_head: ["it", "admin"].includes(role)
                          ? editing.is_team_head
                          : false,
                      })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="it">IT member</SelectItem>
                      <SelectItem value="admin">Admin member</SelectItem>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Location</Label>
                  <Input
                    className="mt-1"
                    value={editing.location || ""}
                    onChange={(event) =>
                      setEditing({ ...editing, location: event.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>
                  New password{" "}
                  <span className="font-normal text-[#9CA3AF]">
                    (leave blank to keep current)
                  </span>
                </Label>
                <Input
                  className="mt-1"
                  type="password"
                  value={editing.password}
                  onChange={(event) =>
                    setEditing({ ...editing, password: event.target.value })
                  }
                  placeholder="Minimum 6 characters"
                />
              </div>
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <Checkbox
                  checked={editing.active}
                  onCheckedChange={(checked) =>
                    setEditing({ ...editing, active: !!checked })
                  }
                />
                Account active
              </label>
              {["it", "admin"].includes(editing.role) && (
                <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                  <Checkbox
                    checked={editing.is_team_head}
                    onCheckedChange={(checked) =>
                      setEditing({ ...editing, is_team_head: !!checked })
                    }
                  />
                  <span>
                    <b className="block">Team head</b>
                    <span className="text-xs text-[#9CA3AF]">
                      Can assign department tickets to other team members.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

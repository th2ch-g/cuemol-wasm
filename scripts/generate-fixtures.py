import math
import statistics
import struct
from pathlib import Path

root = Path(__file__).resolve().parent.parent
output = root / ".cache/fixtures"
output.mkdir(parents=True, exist_ok=True)
coords = [(1.0, 2.0, 3.0), (1.96, 2.0, 3.0), (0.76, 2.93, 3.0)]
gro = ["Synthetic water trajectory", f"{len(coords):5d}"]
for index, (name, xyz) in enumerate(zip(["OW", "HW1", "HW2"], coords), 1):
    gro.append(f"{1:5d}{'SOL':<5s}{name:>5s}{index:5d}" + "".join(f"{v / 10:8.3f}" for v in xyz))
gro.append("   2.00000   2.00000   2.00000")
(output / "water.gro").write_text("\n".join(gro) + "\n")

def record(data):
    return struct.pack("<i", len(data)) + data + struct.pack("<i", len(data))

header = bytearray(84)
header[:4] = b"CORD"
for offset, value in [(4, 3), (12, 1), (16, 3), (80, 24)]:
    struct.pack_into("<i", header, offset, value)
struct.pack_into("<f", header, 40, 1.0)
dcd = record(header) + record(struct.pack("<i", 1) + b"Synthetic browser test".ljust(80)) + record(struct.pack("<i", 3))
for frame in range(3):
    for axis in range(3):
        dcd += record(struct.pack("<3f", *(xyz[axis] + (frame * 0.8 if axis == 0 else 0.0) for xyz in coords)))
(output / "water.dcd").write_bytes(dcd)

size = 24
density = [math.exp(-((x - 12) ** 2 + (y - 12) ** 2 + (z - 12) ** 2) / 24) for z in range(size) for y in range(size) for x in range(size)]
header = bytearray(1024)
struct.pack_into("<10i", header, 0, size, size, size, 2, 0, 0, 0, size, size, size)
struct.pack_into("<6f", header, 40, size, size, size, 90, 90, 90)
struct.pack_into("<3i", header, 64, 1, 2, 3)
struct.pack_into("<3f", header, 76, min(density), max(density), statistics.mean(density))
struct.pack_into("<2i", header, 88, 1, 0)
header[208:212] = b"MAP "
header[212:216] = b"DA\x00\x00"
struct.pack_into("<fi", header, 216, statistics.pstdev(density), 1)
header[224:304] = b"Synthetic Gaussian density for browser integration tests".ljust(80)
(output / "density.map").write_bytes(header + struct.pack(f"<{len(density)}f", *density))

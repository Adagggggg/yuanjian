import nzh from 'nzh';

export default function formatGroupName(name: string | null, userCount: number): string {
  return name ?? (userCount <= 2 ? '一对一通话' : `${nzh.cn.encodeS(userCount)}人通话`);
}

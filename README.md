# Posso gastar?

App web (PWA) para celular, com visual no estilo iOS, que reproduz a planilha **CUSTOS - PESSOAIS**: controle diário de saldo, cartões de crédito com fatura e uma calculadora de investimentos.

## Como a planilha calcula (e o app também)

| Coluna da planilha | No app | Efeito no saldo |
|---|---|---|
| SALDO (1ª coluna) | Entrada | soma no dia |
| SAÍDAS | Saída | subtrai no dia |
| SAÍDAS em verde claro | Investimento | subtrai no dia e entra no total investido |
| C6 / LATAM | Cartão | não mexe no saldo do dia: vira fatura |
| SALDO (última coluna) | Saldo do dia | saldo anterior + entradas − saídas − faturas |

Cartões (compras não mexem no saldo do dia; a fatura é debitada no vencimento):

| Cartão | Ciclo de compras | Vencimento |
|---|---|---|
| LATAM | dia 1 ao último dia do mês | dia 1 do mês seguinte |
| CAIXA | dia 28 do mês anterior ao dia 27 | dia 8 do mês seguinte |
| C6 | dia 1 ao último dia do mês | dia 10 do mês seguinte |

## Sobra para aplicar

As contas do início do mês (dia 1 em diante) são pagas com o saldo do mês anterior. A **sobra** é o saldo no dia anterior aos recebimentos (padrão: dia 4, recebimentos a partir do dia 5) e é o valor disponível para aplicar. O dia é configurável em Ajustes.

Ao registrar um lançamento, o app mostra antes de salvar quando ele sai do saldo, como fica a sobra afetada e se o saldo fica negativo nos próximos 12 meses.

## Usar

Abra `index.html` servido por HTTP (por exemplo, GitHub Pages) e use "Adicionar à tela inicial" no celular. Os dados ficam salvos só no aparelho (localStorage); use **Ajustes → Exportar** para fazer backup.

## Posso gastar?

Simulador que não salva nada: informe valor, à vista ou cartão, data e parcelas. O app mostra o maior valor que dá para gastar sem o saldo ficar negativo (ou abaixo de um mínimo que você quer guardar) nos próximos 12 meses, o veredito e um gráfico do saldo com e sem a compra. Se gostar, toque em "Registrar esta compra".

## Entradas e saídas previstas

Entradas e saídas que não são de cartão podem ser **previstas**: entram na projeção, mas o valor pode mudar. As recorrentes são sempre previstas; as avulsas são previstas quando a data é futura (dá para marcar ou desmarcar no lançamento). Quando a data chega, elas aparecem em **🔔 Para confirmar** na tela do mês. Ao confirmar você informa o valor e a data reais, e o app mostra a diferença em relação ao previsto. Valor 0 = não houve pagamento. Excluir um pagamento confirmado de uma recorrência devolve o valor previsto.

## Projeção de 1 ano

Dois cenários na aba Projeção:
- **Mantendo o ritmo:** recorrências continuam sem data de fim (exceto parcelamentos) e as compras no cartão seguem a média dos últimos 3 meses completos (editável). Se as compras cadastradas num mês ficarem abaixo da média, a diferença é descontada no dia 1 do mês seguinte.
- **Só o cadastrado:** apenas o que está lançado.

## Código de acesso

Na primeira abertura o app pede para criar um código de 4 dígitos, pedido de novo a cada abertura e depois de 1 minuto fora do app. Após 5 erros seguidos, o teclado trava por 30 s (dobrando a cada novo erro). Só um hash SHA-256 com sal é salvo. O código impede o acesso pela tela do app, mas **não criptografa** os dados guardados no navegador. "Esqueci o código" apaga os dados do aparelho (é possível importar um backup depois).
